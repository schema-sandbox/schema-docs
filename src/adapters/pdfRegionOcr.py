"""Bounded image-region OCR, reversible transforms and source-space word boxes."""
import math
import time
import statistics
from contextlib import nullcontext


def select_regions(page):
    """Find raster areas not already explained by a native text layer.

    The queue is smaller than the source candidate set, but every candidate
    keeps a disposition record so filtering and deduplication remain auditable.
    """
    origin_x, origin_y = page.bbox[:2]
    ledger = []
    try:
        page._schema_docs_ocr_candidate_ledger = ledger
    except Exception:
        pass
    if not page.images: return []
    words = page.extract_words(x_tolerance=2, y_tolerance=3) or []
    regions = []
    for image_index, image in enumerate(page.images):
        candidate_id = f"candidate-{image_index + 1}"
        box = [max(origin_x, float(image['x0'])), max(origin_y, float(image['top'])),
               min(origin_x+page.width, float(image['x1'])), min(origin_y+page.height, float(image['bottom']))]
        area = (box[2]-box[0])*(box[3]-box[1])
        ledger_entry = {'id': candidate_id, 'sourceIndex': image_index, 'bbox': box}
        if area < page.width*page.height*.002 or box[2]-box[0] < 30 or box[3]-box[1] < 12:
            ledger.append({**ledger_entry, 'disposition': 'filtered', 'reason': 'too_small'})
            continue
        inside = [w for w in words if box[0] <= (w['x0']+w['x1'])/2 <= box[2]
                  and box[1] <= (w['top']+w['bottom'])/2 <= box[3]]
        coverage = sum((w['x1']-w['x0'])*(w['bottom']-w['top']) for w in inside)/max(1, area)
        # A dense native layer is authoritative; sparse labels don't hide a scan.
        if coverage > .12 and sum(len(w['text']) for w in inside) >= 32:
            ledger.append({**ledger_entry, 'disposition': 'native_covered', 'reason': 'complete_native_text'})
            continue
        duplicate = next((r for r in regions if all(abs(a-b)<2 for a,b in zip(box, r['bbox']))), None)
        if duplicate:
            # The ledger is keyed by source candidate ids. ``duplicateOf``
            # therefore points to the candidate that won scheduling, while
            # the region id remains available for consumers that need the
            # rendered OCR crop. Previously this pointed at ``ocr-*`` and the
            # JS validator correctly (but incorrectly for the producer)
            # reported every normal duplicate as dangling.
            ledger.append({**ledger_entry, 'disposition': 'duplicate', 'reason': 'same_bbox',
                           'duplicateOf': duplicate['candidateId'],
                           'duplicateOfRegionId': duplicate['id']})
            continue
        region_id = f'ocr-{len(regions)+1}'
        ledger.append({**ledger_entry, 'disposition': 'requested', 'regionId': region_id,
                       'nativeCoverage': round(coverage, 4), 'reason': 'raster_without_complete_native_layer'})
        regions.append({'id': region_id, 'candidateId': candidate_id, 'bbox': box, 'nativeCoverage': round(coverage,4),
                        'reason': 'raster_without_complete_native_layer'})
    return regions


def text_likelihood(image):
    """Estimate whether an image deserves OCR work.

    This is a scheduling hint only. Dark backgrounds, photographs, and
    anti-aliased labels can have weak global histogram signals while still
    containing useful text, so callers must not turn ``False`` into a
    terminal non-text decision.
    """
    gray = image.convert('L')
    gray.thumbnail((900,900))
    histogram = gray.histogram()
    count = gray.width*gray.height
    dark = sum(histogram[:150])/max(1,count)
    binary = (sum(histogram[:60])+sum(histogram[215:]))/max(1,count)
    gray.close()
    return .001 < dark < .55 and binary >= .72


def deskew_angle(image):
    probe=image.convert('L')
    probe.thumbnail((600,600))
    scores=[]
    for angle in (0,-3,-1.5,1.5,3):
        candidate=probe.rotate(angle,expand=False,fillcolor=255)
        # Threshold and project using Pillow's native loops. The former
        # Python pixel loop ran once per direction and dominated small crops.
        binary=candidate.point(lambda value: 255 if value < 150 else 0)
        projection=binary.resize((1,binary.height),resample=__import__('PIL.Image',fromlist=['Resampling']).Resampling.BOX)
        rows=list(projection.getdata())
        projection.close()
        binary.close()
        scores.append((statistics.pvariance(rows) if rows else 0,angle))
        candidate.close()
    probe.close()
    best=max(scores)
    return best[1] if best[0] > scores[0][0]*1.15 else 0


def inverse_transform(angle, original_size, rotated_size, crop, scale, origin):
    radians=math.radians(angle)
    cosine,sine=math.cos(radians),math.sin(radians)
    cx,cy=original_size[0]/2,original_size[1]/2
    rx,ry=rotated_size[0]/2,rotated_size[1]/2
    return [cosine/scale,-sine/scale,origin[0]+(crop[0]+cx-cosine*rx+sine*ry)/scale,
            sine/scale,cosine/scale,origin[1]+(crop[1]+cy-sine*rx-cosine*ry)/scale]


def map_box(box, transform):
    a,b,c,d,e,f=transform
    points=[(a*x+b*y+c,d*x+e*y+f) for x in (box[0],box[2]) for y in (box[1],box[3])]
    return [min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]


def recover_table_cells(engine, image, words, dpi):
    """Retry only a proven ruled grid, with at most 100 cells and one engine."""
    from pdfTableStructure import scanned_table_grid
    grid=scanned_table_grid(image,None)
    if not grid or len(grid['cellBoxes'])>100: return words,None
    recovered=[]
    try:
        engine.lib.TessBaseAPISetPageSegMode(engine.api,6)
        for index,cell in enumerate(grid['cellBoxes']):
            x0,y0,x1,y1=cell['bbox']
            crop=(math.ceil(x0+2),math.ceil(y0+2),math.floor(x1-2),math.floor(y1-2))
            if crop[2]<=crop[0] or crop[3]<=crop[1]: return words,None
            cut=image.crop(crop).convert('L')
            # The grid is already known; remove light fills inside cells only.
            binary=cut.point(lambda value:0 if value<145 else 255)
            cut.close()
            try: _,found=engine.recognize(binary,dpi,1,1)
            finally: binary.close()
            for word in found:
                a,b,c,d=word['bbox']
                recovered.append({**word,'bbox':[a+crop[0],b+crop[1],c+crop[0],d+crop[1]],'line':[index+1,*word['line']]})
    finally:
        engine.lib.TessBaseAPISetPageSegMode(engine.api,engine.psm)
    table=scanned_table_grid(image,recovered)
    if not table: return words,None
    box=grid['bbox']
    outside=[word for word in words if not (box[0]<=(word['bbox'][0]+word['bbox'][2])/2<=box[2]
            and box[1]<=(word['bbox'][1]+word['bbox'][3])/2<=box[3])]
    table['cellOcr']=True
    return outside+recovered,table


def recognize_region(engine, image, region, number, scale, origin):
    region_started=time.perf_counter()
    box=region['bbox']
    crop=(max(0,math.floor((box[0]-origin[0])*scale)),max(0,math.floor((box[1]-origin[1])*scale)),
          min(image.width,math.ceil((box[2]-origin[0])*scale)),min(image.height,math.ceil((box[3]-origin[1])*scale)))
    if crop[2]<=crop[0] or crop[3]<=crop[1]:
        return {**region,'status':'failed','text':'','words':[],'reason':'invalid_crop'}
    source=image.crop(crop)
    try:
        # Only near-uniform pixels prove a blank crop. Continuous-tone images
        # can contain labels; their histogram alone cannot certify non-text.
        gray=source.convert('L')
        extrema=gray.getextrema()
        gray.close()
        if extrema[1]-extrema[0] <= 2:
            return {**region,'status':'non_text','text':'','words':[],'reason':'uniform_pixels',
                    'timingsMs':{'total':round((time.perf_counter()-region_started)*1000,3)}}
        # A weak histogram signal is only a scheduling hint. It cannot prove
        # that the crop is visual-only: dark-background labels and white text
        # over photographs are valid OCR content. Keep the hint for telemetry
        # but still run the bounded orientation candidates.
        likelihood_started=time.perf_counter()
        likely_text = text_likelihood(source)
        likelihood_ms = round((time.perf_counter()-likelihood_started)*1000,3)
        attempts=[]
        best=None
        corrections={}
        timing={'deskew':0,'recognition':0,'table':0}
        for orientation in (0,90,270,180):
            attempt_started=time.perf_counter()
            stage=time.perf_counter()
            axis=orientation % 180
            if axis not in corrections:
                oriented=source.rotate(axis,expand=True,fillcolor='white')
                corrections[axis]=deskew_angle(oriented)
                oriented.close()
            correction=corrections[axis]
            timing['deskew']+=(time.perf_counter()-stage)*1000
            angle=orientation+correction
            candidate=source.rotate(angle,expand=True,fillcolor='white')
            stage=time.perf_counter()
            text,words=engine.recognize(candidate,scale*72,number,1)
            timing['recognition']+=(time.perf_counter()-stage)*1000
            transform=inverse_transform(angle,source.size,candidate.size,crop,scale,origin)
            stage=time.perf_counter()
            from pdfTableStructure import scanned_table_grid, borderless_table_regions
            table=scanned_table_grid(candidate,words)
            if not table:
                words,table=recover_table_cells(engine,candidate,words,scale*72)
                if table: text=' '.join(word['text'] for word in words)
            # Confidence selects candidates; accuracy is measured against source truth.
            reliable=[w for w in words if w['confidence']>=.55 and any(ch.isalnum() for ch in w['text'])]
            score=sum(len(w['text'])*w['confidence'] for w in reliable)
            attempts.append({'angle':angle,'score':round(score,3),'wordCount':len(words),
                             'elapsedMs':round((time.perf_counter()-attempt_started)*1000,3)})
            tables=[table] if table else []
            if not tables:
                pixel_words=[{'id':i,'text':w['text'],**dict(zip(('x0','top','x1','bottom'),w['bbox']))} for i,w in enumerate(words)]
                class WordPage:
                    def extract_words(self,**kwargs): return pixel_words
                tables=borderless_table_regions(WordPage(),number)
            timing['table']+=(time.perf_counter()-stage)*1000
            candidate.close()
            if best is None or score>best['score']:
                for word in words:
                    word.update(bbox=map_box(word['bbox'],transform),regionId=region['id'])
                for table in tables:
                    table['bbox']=map_box(table['bbox'],transform)
                    for cell in table['cellBoxes']: cell['bbox']=map_box(cell['bbox'],transform)
                best={'text':text,'words':words,'score':score,'transform':transform,'angle':angle,'tables':tables,'table':tables[0] if tables else None}
            if score>=24 and reliable and len(reliable)>=len(words)*.85:
                break
        accepted=bool(best and best['score']>=3 and len(best['words'])>=2)
        if accepted:
            reason=''
        elif not best:
            reason='no_ocr_candidate'
        elif not best.get('words'):
            reason='no_words'
        elif best.get('score', 0) < 3:
            reason='low_confidence'
        else:
            reason='too_short'
        if not likely_text and not accepted:
            reason='low_text_likelihood'
        reliable_count=sum(1 for word in (best or {}).get('words', [])
                           if word.get('confidence', 0) >= .55 and any(ch.isalnum() for ch in word.get('text', '')))
        # A complete visual fallback preserves the source pixels when a bounded
        # OCR attempt finds no reliable words.  Record that outcome explicitly
        # so it is terminal for scheduling while remaining visibly non-editable.
        visual_only = bool(not accepted and region.get('visualFallbackCoverage'))
        return {**region,**(best or {}),'attempts':attempts,'status':'completed' if accepted else ('visual_only' if visual_only else 'unresolved'),
                'reason':'visual_fallback_unresolved' if visual_only else reason,'selectedScore':round((best or {}).get('score', 0), 3),
                'candidateText':(best or {}).get('text','') if not accepted else '',
                'reliableWordCount':reliable_count,
                'timingsMs':{**{key:round(value,3) for key,value in timing.items()},
                             'textLikelihood': likelihood_ms,
                             'total':round((time.perf_counter()-region_started)*1000,3)},
                'coordinateSpace':'source_page','transformVersion':1,
                'text':best['text'] if accepted else '', 'words':best['words'] if accepted else []}
    finally:
        source.close()


def recognize_page(engine, image, number, scale, config, width, height):
    page_started=time.perf_counter()
    settings=config.get('pageRegions',{}).get(str(number),{})
    origin=settings.get('coordinateOrigin',[0,0])
    regions=settings.get('regions')
    if regions is None:
        regions=[{'id':'ocr-page','bbox':[origin[0],origin[1],origin[0]+width,origin[1]+height]}]
    results=[]
    cached=config.get('_cachedRegions',{})
    reuse=config.get('_reuseRegion',lambda region: region.get('status') in ('completed','non_text'))
    committed=config.get('_onRegion')
    # Process every requested region in bounded batches. The batch boundary
    # controls memory and progress reporting; it must never discard regions.
    try:
        batch_size = int(config.get('regionBatchSize', 16) or 16)
    except (TypeError, ValueError):
        batch_size = 16
    batch_size = max(1, min(batch_size, 64))
    for offset in range(0, len(regions), batch_size):
        for region in regions[offset:offset + batch_size]:
            previous=cached.get(str(region['id']))
            if previous and reuse(previous):
                results.append(previous)
                continue
            try:
                monitor=config.get('_resourceMonitor')
                with monitor.deadline('region',config.get('regionTimeoutMs')) if monitor else nullcontext():
                    result=recognize_region(engine,image,region,number,scale,origin)
            except Exception as error:
                result={**region,'status':'failed','text':'','words':[],'reason':str(error)}
            result.update(candidateReason=region.get('reason',''),
                          attemptCount=int((previous or {}).get('attemptCount',0))+1,retryPolicyVersion=2)
            results.append(result)
            if committed: committed(result,len(results),len(regions))
    words=[]
    for index,result in enumerate(results):
        for word in result.get('words',[]):
            words.append({**word,'line':[index+1,*word['line']]})
    pending=any(r['status'] not in ('completed','non_text','visual_only') for r in results)
    return {'page':number,'width':width,'height':height,'regions':results,'words':words,
            'text':'\n\n'.join(r['text'] for r in results if r.get('text')),
            'status':'partial' if pending else 'completed','coordinateSpace':'source_page',
            'effectiveDpi':scale*72,
            'regionBatchSize':batch_size,
            'regionBatches':(len(regions) + batch_size - 1) // batch_size,
            'regionsRequested':len(regions),
            'regionsProcessed':len(results),
            'timingsMs':{'total':round((time.perf_counter()-page_started)*1000,3),
                         'regionTotal':round(sum(float(r.get('timingsMs',{}).get('total',0)) for r in results),3)}}
