import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveLayoutTimeoutMs } from "../src/adapters/pdfLayoutExtractor.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extractorPath = path.join(repoRoot, "src", "adapters", "pdfLayoutExtractor.py");

function reconstruct(components) {
  const script = [
    "import importlib.util,json,sys",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "print(module.reconstruct_formula_latex(json.loads(sys.stdin.read())))"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath], {
    cwd: repoRoot,
    input: JSON.stringify(components),
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function hasDisplaySemantics(latex, text = "", signalCount = 0) {
  const script = [
    "import importlib.util,sys",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "print('true' if module.has_display_formula_semantics(sys.argv[2],sys.argv[3],int(sys.argv[4])) else 'false')"
  ].join(";");
  const result = spawnSync(
    "python",
    ["-c", script, extractorPath, latex, text, String(signalCount)],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONDONTWRITEBYTECODE: "1"
      }
    }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() === "true";
}

function inlineLargeOperators(chars) {
  const script = [
    "import importlib.util,json,sys,types",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "page=types.SimpleNamespace(chars=json.loads(sys.stdin.read()),width=612,height=792)",
    "module.repair_known_cid_chars(page)",
    "module.repair_tex_font_ascii_chars(page)",
    "regions=module.inline_large_operator_regions(page,1)",
    "print(json.dumps([{k:v for k,v in r.items() if k!='_chars'} for r in regions]))"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath], {
    cwd: repoRoot,
    input: JSON.stringify(chars),
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function isValidEditableLatex(value) {
  const script = [
    "import importlib.util,sys",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "print('true' if module.is_valid_editable_latex(sys.argv[2]) else 'false')"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath, value], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() === "true";
}

function requiresVisualFallback(sourceText, latex = "") {
  const script = [
    "import importlib.util,sys",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "print('true' if module.formula_requires_visual_fallback(sys.argv[2],sys.argv[3]) else 'false')"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath, sourceText, latex], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" }
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() === "true";
}

function repairCid(fontname, cid) {
  const script = [
    "import importlib.util,json,sys,types",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "char={'text':'(cid:'+sys.argv[3]+')','fontname':sys.argv[2]}",
    "page=types.SimpleNamespace(chars=[char],width=612,height=792)",
    "module.repair_known_cid_chars(page)",
    "sys.stdout.write(json.dumps(char['text']))"
  ].join(";");
  const result = spawnSync(
    "python",
    ["-c", script, extractorPath, fontname, String(cid)],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONDONTWRITEBYTECODE: "1"
      }
    }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function hasMathOperand(value) {
  const script = [
    "import importlib.util,sys",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "print('true' if module.has_math_operand(sys.argv[2]) else 'false')"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath, value], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() === "true";
}

function normalizeReconstructed(value) {
  const script = [
    "import importlib.util,json,sys",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "sys.stdout.write(json.dumps(module.normalize_reconstructed_latex(sys.argv[2],[])))"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath, value], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function splitTrailingPeriod(value) {
  const script = [
    "import importlib.util,json,sys",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "sys.stdout.write(json.dumps(list(module.split_trailing_sentence_period(sys.argv[2]))))"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath, value], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function normalizeReconstructedLatex(value) {
  const script = [
    "import importlib.util,json,sys",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "sys.stdout.write(json.dumps(module.normalize_reconstructed_latex(sys.argv[2],[])))"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath, value], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function stripProse(value) {
  const script = [
    "import importlib.util,json,sys",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "sys.stdout.write(json.dumps(module.strip_prose_from_formula(sys.argv[2])))"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath, value], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function rejoinOperatorLines(lines) {
  const script = [
    "import importlib.util,json,sys",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "sys.stdout.write(json.dumps(module.rejoin_operator_only_lines(json.loads(sys.stdin.read()))))"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath], {
    cwd: repoRoot,
    input: JSON.stringify(lines),
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function mergeSingleFormulaRegion(region) {
  const script = [
    "import importlib.util,json,sys,types",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "page=types.SimpleNamespace(chars=[],width=612,height=792)",
    "result=module.merge_complex_formula_regions([json.loads(sys.stdin.read())],page)",
    "print(json.dumps([{k:v for k,v in item.items() if k!='_chars'} for item in result]))"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath], {
    cwd: repoRoot,
    input: JSON.stringify(region),
    encoding: "utf8",
    env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function reattachInlineOperators(chars) {
  const script = [
    "import importlib.util,json,sys,types",
    "spec=importlib.util.spec_from_file_location('extractor',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "page=types.SimpleNamespace(chars=json.loads(sys.stdin.read()),width=612,height=792,initial_doctop=0)",
    "module.reattach_inline_operator_baselines(page)",
    "print(json.dumps(page.chars))"
  ].join(";");
  const result = spawnSync("python", ["-c", script, extractorPath], {
    cwd: repoRoot,
    input: JSON.stringify(chars),
    encoding: "utf8",
    env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function glyph(text, fontname, size, x0, top, width = size * 0.55) {
  return { text, fontname, size, x0, x1: x0 + width, top, bottom: top + size };
}

function component(chars) {
  return {
    _chars: chars,
    bbox: [
      Math.min(...chars.map((char) => char.x0)),
      Math.min(...chars.map((char) => char.top)),
      Math.max(...chars.map((char) => char.x1)),
      Math.max(...chars.map((char) => char.bottom))
    ]
  };
}

test("PDF text-layer fractions and exponents remain editable LaTeX", () => {
  const roman = "CMR10";
  const italic = "CMMI10";
  const smallRoman = "CMR7";
  const smallItalic = "CMMI7";
  const main = [
    glyph("n", italic, 10, 0, 20),
    glyph("e", roman, 10, 7, 20),
    glyph("x", roman, 10, 12, 20),
    glyph("p", roman, 10, 17, 20),
    glyph("c", italic, 10, 29, 20),
    glyph("=", roman, 10, 67, 20),
    glyph("n", italic, 10, 78, 20)
  ];
  const exponentText = "1+c=loglogn+o(1=loglogn)";
  const exponent = [...exponentText].map((text, index) =>
    glyph(text, /[cnog=]/.test(text) ? smallItalic : smallRoman, 7, 85 + index * 4, 18)
  );
  const numerator = [..."logn"].map((text, index) =>
    glyph(text, text === "n" ? italic : roman, 10, 38 + index * 5, 13)
  );
  const denominator = [..."loglogn"].map((text, index) =>
    glyph(text, text === "n" ? italic : roman, 10, 34 + index * 5, 27)
  );
  const latex = reconstruct([
    component([...main, ...exponent]),
    component(numerator),
    component(denominator)
  ]);
  assert.match(latex, /\\exp/);
  assert.match(latex, /\\frac\{\\log n\}\{\\log \\log n\}/);
  assert.match(latex, /n\^\{1\+c\/\\log \\log n/);
  assert.doesNotMatch(latex, /mathord\{\?\}/);
});

test("stacked display fractions do not become superscripts", () => {
  const roman = "CMR10";
  const italic = "CMMI10";
  const numerator = [
    glyph("d", italic, 10, 298.6, 394.7),
    glyph("L", italic, 10, 303.8, 394.7)
  ];
  const denominator = [
    glyph("l", roman, 10, 288.3, 408.3),
    glyph("o", roman, 10, 291.1, 408.3),
    glyph("g", roman, 10, 296.1, 408.3),
    glyph("(", roman, 10, 301.2, 408.3),
    glyph("d", italic, 10, 305.1, 408.3),
    glyph("L", italic, 10, 310.2, 408.3),
    glyph(")", roman, 10, 317.0, 408.3)
  ];
  const latex = reconstruct([component(numerator), component(denominator)]);
  assert.equal(latex.replace(/\s+/g, ""), String.raw`\frac{dL}{\log(dL)}`);
  assert.doesNotMatch(latex, /\^\{dL\}/);
});

test("centred products remain display formulas without detached superscripts", () => {
  const main = [
    glyph("s", "CMMI10", 10, 290.2, 352.9),
    glyph("l", "CMR10", 10, 296.6, 352.9),
    glyph("o", "CMR10", 10, 299.3, 352.9),
    glyph("g", "CMR10", 10, 304.3, 352.9),
    glyph("E", "CMMI10", 10, 311.1, 352.9),
    glyph(":", "CMMI10", 10, 319.0, 352.9)
  ];
  const detachedProseScript = component([glyph("0", "CMR7", 7, 361.7, 334.9)]);
  const latex = reconstruct([component(main), detachedProseScript]);
  assert.equal(latex.replace(/\s+/g, ""), String.raw`s\logE`);
  assert.equal(hasDisplaySemantics(latex, "slogE", 0), true);
  assert.doesNotMatch(latex, /\^\{0\}/);
});

test("PDF text-layer product limits remain editable LaTeX", () => {
  const main = [
    glyph("k", "CMMI10", 10, 0, 20),
    glyph("=", "CMR10", 10, 7, 20),
    glyph("\u220f", "CMEX10", 10, 18, 9, 10),
    glyph("p", "CMMI10", 10, 31, 20)
  ];
  const upper = [glyph("t", "CMMI7", 7, 21, 8)];
  const lower = [
    glyph("i", "CMMI7", 7, 18, 32),
    glyph("=", "CMR7", 7, 22, 32),
    glyph("1", "CMR7", 7, 27, 32)
  ];
  const subscript = [glyph("i", "CMMI7", 7, 36, 25)];
  const latex = reconstruct([
    component(main),
    component(upper),
    component(lower),
    component(subscript)
  ]);
  assert.match(latex, /\\prod/);
  assert.match(latex, /\^\{t\}/);
  assert.match(latex, /_\{i=1\}/);
  assert.match(latex, /p_\{i\}/);
});

test("PDF set-builder glyph stacks reconstruct as valid editable LaTeX", () => {
  const components = [
    { ...component([glyph("P", "CMMI10", 10, 0, 20), glyph("=", "CMR10", 10, 8, 20)]), text: "P=" },
    { ...component([glyph("\u2211", "CMEX10", 12, 20, 14)]), text: "\u2211" },
    { ...component([glyph("i", "CMMI7", 7, 20, 30), glyph("\u2208", "CMSY7", 7, 24, 30), glyph("S", "CMMI7", 7, 29, 30)]), text: "i\u2208S" },
    { ...component([glyph("u", "CMMI10", 10, 35, 20), glyph("i", "CMMI7", 7, 41, 26)]), text: "ui:S\u2286{1,:::,d}" }
  ];
  const latex = reconstruct(components);
  assert.equal(latex, String.raw`P=\left\{\sum_{i\in S}u_i:S\subseteq\{1,\ldots,d\}\right\}`);
});

test("duplicate PDF script runs collapse instead of producing KaTeX errors", () => {
  const main = [
    glyph("e", "CMMI10", 10, 0, 20),
    glyph("\u2265", "CMSY10", 10, 16, 20),
    glyph("m", "CMMI10", 10, 28, 20)
  ];
  const firstSubscript = [glyph("m", "CMMI7", 7, 5, 27)];
  const duplicateSubscript = [glyph("m", "CMMI7", 7, 6, 28)];
  const latex = reconstruct([
    component(main),
    component(firstSubscript),
    component(duplicateSubscript)
  ]);
  assert.doesNotMatch(latex, /_\{m\}_\{m\}/);
});

test("isolated inline variables are not promoted to display equations", () => {
  assert.equal(hasDisplaySemantics("K", "K", 0), false);
  assert.equal(hasDisplaySemantics("2,3", "2,3", 0), false);
  assert.equal(hasDisplaySemantics(String.raw`e_m\ge m^2`, "em\u2265m2", 2), true);
});

test("lesssim and a radical radicand retain their PDF semantics", () => {
  const root = component([glyph("\u221a", "CMEX10", 10, 36, 10, 10)]);
  const main = [
    glyph("e", "CMMI10", 10, 0, 21),
    glyph("\u2272", "MSAM10", 10, 8, 19),
    glyph("n", "CMMI10", 10, 19, 21),
    glyph("3", "CMR7", 7, 24, 18),
    glyph("=", "CMMI7", 7, 28, 18),
    glyph("2", "CMR7", 7, 32, 18),
    glyph("l", "CMR10", 10, 46, 21),
    glyph("o", "CMR10", 10, 50, 21),
    glyph("g", "CMR10", 10, 55, 21),
    glyph("n", "CMMI10", 10, 62, 21),
    glyph(";", "CMMI10", 10, 68, 21)
  ];
  const latex = reconstruct([root, component(main)]);
  assert.equal(latex, String.raw`e\lesssim n^{3/2}\sqrt{\log n},`);
  assert.doesNotMatch(latex, /\\le\s+sssim|\\le(?:\s|$)/);
});

test("inline sums retain limits and summand on the prose baseline", () => {
  const chars = [];
  for (const [index, text] of [..."Then the number of ordered unit edges is"].entries()) {
    if (text !== " ") chars.push(glyph(text, "LMRoman10-Regular", 10, index * 5, 100));
  }
  chars.push(glyph("P", "CMEX10", 10, 205, 90, 11));
  chars.push(glyph("u", "CMMI7", 7, 214, 105));
  chars.push(glyph("\u2208", "CMSY7", 7, 219, 104));
  chars.push(glyph("S", "CMMI7", 7, 225, 105));
  chars.push(glyph("1", "CMR5", 5, 231, 103));
  chars.push(glyph("r", "CMMI10", 10, 238, 100));
  chars.push(glyph("(", "CMR10", 10, 243, 100));
  chars.push(glyph("u", "CMMI10", 10, 247, 100));
  chars.push(glyph(")", "CMR10", 10, 253, 100));
  chars.push(glyph(",", "LMRoman10-Regular", 10, 258, 100));
  const regions = inlineLargeOperators(chars);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].latex, String.raw`\sum_{u\in S^{1}} r(u)`);
  assert.equal(regions[0].displayMathLine, false);
  assert.equal(regions[0].markerTop, 100);
});

test("stacked CMEX norm bars collapse without corrupting the summand", () => {
  const chars = [
    glyph("\u2016", "CMEX10", 10, 0, 0, 5),
    glyph("\u2016", "CMEX10", 10, 0, 6, 5),
    glyph("\u2016", "CMEX10", 10, 0, 12, 5),
    glyph("\u2211", "CMEX10", 10, 6, 2, 14),
    glyph("v", "CMMI10", 10, 22, 13),
    glyph("i", "CMMI7", 7, 27, 17),
    glyph("g", "CMMI10", 10, 30, 13),
    glyph("i", "CMMI7", 7, 35, 17),
    glyph("\u2016", "CMEX10", 10, 39, 0, 5),
    glyph("\u2016", "CMEX10", 10, 39, 6, 5),
    glyph("\u2016", "CMEX10", 10, 39, 12, 5),
    glyph("=", "CMR10", 10, 47, 13),
    glyph("1", "CMR10", 10, 57, 13)
  ];
  const latex = reconstruct([component(chars)]);
  assert.equal(latex.replace(/\s+/g, ""), String.raw`\Vert\sumv_{i}g_{i}\Vert=1`);
  assert.doesNotMatch(latex, /\?|mathord/);
});

test("stacked CMEX absolute bars retain the outer square", () => {
  const chars = [
    glyph("|", "CMEX10", 10, 0, 0, 3),
    glyph("|", "CMEX10", 10, 0, 6, 3),
    glyph("|", "CMEX10", 10, 0, 12, 3),
    glyph("\u2211", "CMEX10", 10, 4, 2, 14),
    glyph("a", "CMMI10", 10, 20, 13),
    glyph("i", "CMMI7", 7, 25, 17),
    glyph("z", "CMMI10", 10, 28, 13),
    glyph("i", "CMMI7", 7, 33, 17),
    glyph("|", "CMEX10", 10, 37, 0, 3),
    glyph("|", "CMEX10", 10, 37, 6, 3),
    glyph("|", "CMEX10", 10, 37, 12, 3),
    glyph("2", "CMR7", 7, 41, 8),
    glyph("=", "CMR10", 10, 48, 13),
    glyph("1", "CMR10", 10, 58, 13)
  ];
  const latex = reconstruct([component(chars)]);
  assert.equal(latex, String.raw`|\sum a_{i}z_{i}|^{2}=1`);
  assert.doesNotMatch(latex, /\?|mathord/);
});

test("operator fragments lifted out of prose are not emitted as math", () => {
  // pdfplumber reports the math-font operators of a sentence such as
  // "a \cdot b \in G" as their own region while the operands stay in the text
  // layer. Emitting those fragments produces empty shells like "$$\cdot \in$$"
  // and leaves the sentence truncated, so they must be rejected outright.
  const shells = [
    String.raw`\cdot \in \in`,
    String.raw`\cdot \in`,
    String.raw`\in \in \cdot ^{-}\cdot`,
    String.raw`\in -`,
    String.raw`\cdot \times \to \in`,
    String.raw`{\prime}\cdot \in`,
    String.raw`\cdot ^{\prime \prime}\in`,
    String.raw`{\prime}\{^{\prime}\}`,
    String.raw`\sim \sim`,
    String.raw`\to \subseteq \subseteq`,
    String.raw`\{|\in \}\in`,
    "--",
    "----",
    "()()()()()()",
    String.raw`-\{\}`,
    String.raw`(\pm _{\pm})`
  ];
  for (const shell of shells) {
    assert.equal(isValidEditableLatex(shell), false, `expected rejection: ${shell}`);
  }
});

test("real equations survive the operand guard", () => {
  const equations = [
    String.raw`e_{\prime}=e_{\prime \cdot}e_{\prime \prime},`,
    String.raw`a(h_{1},...,h_{n})=h_{1}+_{\cdot \cdot}+h_{n},`,
    String.raw`AA^{1}_{-}=A^{1}_{-}A=I_{n}.`,
    String.raw`g^{n+1}=g_{\cdot}g^{n}.`,
    String.raw`S=_{\{}(x,y,z)_{\in |}x+y+z=1_{\}}.`,
    String.raw`\sum _{i=1}^{n}a_{i}`,
    String.raw`\int _{0}^{1}f(x)dx`,
    String.raw`a\le b`,
    "x+2x_{-}x=1",
    "Ax=b."
  ];
  for (const equation of equations) {
    assert.equal(isValidEditableLatex(equation), true, `expected acceptance: ${equation}`);
  }
});

test("plausible but semantically damaged math uses a source visual fallback", () => {
  for (const [source, latex] of [
    [String.raw`=a(ea^{1})b^{1}istheinverseofb`, String.raw`=a(ea^{1})b^{1}istheinverseofb`],
    [String.raw`\le \le Z-`, String.raw`\le \le Z-`],
    [String.raw`{-}\in R--\in`, String.raw`{-}\in R--\in`],
    [String.raw`x(cid:18)`, String.raw`x(cid:18)`]
  ]) {
    assert.equal(requiresVisualFallback(source, latex), true, `expected visual fallback: ${source}`);
  }
  assert.equal(requiresVisualFallback(String.raw`a\le b`, String.raw`a\le b`), false);
});

test("space-stripped prose is not promoted to a display equation", () => {
  // Roman-font prose that pdfplumber glued into one token used to clear the
  // bare length fallback and render as a display formula.
  for (const prose of [
    "istheidentityelement",
    "associativity",
    "istheinverseofa",
    "beistheidentityelement"
  ]) {
    assert.equal(hasDisplaySemantics(prose, prose), false, `expected rejection: ${prose}`);
  }
  assert.equal(hasDisplaySemantics("x+y=z", "x+y=z"), true);
  assert.equal(hasDisplaySemantics("a=b+c", "a=b+c"), true);
});

test("high-frequency TeX glyph slots recover instead of leaking (cid:N)", () => {
  // Each of these CIDs appeared as visible "(cid:N)" garbage in a real
  // 2000-page mathematics PDF because its font slot had no mapping.
  const expected = [
    ["CMSY10", 54, "\u2260"],
    ["CMSY10", 62, "\u22a4"],
    ["CMSY10", 67, "\u25c1"],
    ["CMSY10", 55, "\u21a6"],
    ["CMSY10", 104, "\u27e8"],
    ["CMSY10", 105, "\u27e9"],
    ["CMSY10", 106, "|"],
    ["CMSY10", 107, "\u2016"],
    ["CMEX10", 80, "\u2211"],
    ["CMEX10", 126, "\u20d7"],
    ["CMMI10", 96, "\u2113"]
  ];
  for (const [fontname, cid, glyphText] of expected) {
    assert.equal(
      repairCid(fontname, cid),
      glyphText,
      `expected (cid:${cid}) in ${fontname} to recover`
    );
  }
});

test("Computer Modern private-use delimiter pieces collapse into editable fences", () => {
  const chars = ["\uf8eb", "\uf8ec", "\uf8ed"].map((text, index) => glyph(text, "CMEX10", 10, 0, index * 7, 5));
  chars.push(glyph("x", "CMMI10", 10, 8, 10), ...["\uf8f6", "\uf8f7", "\uf8f8"].map((text, index) => glyph(text, "CMEX10", 10, 18, index * 7, 5)));
  const latex = reconstruct([component(chars)]);
  assert.equal(latex, "(x)");
  assert.equal(isValidEditableLatex(latex), true);
});

test("private-use and CID remnants are never accepted as editable LaTeX", () => {
  for (const broken of ["Q=\uf8ebx\uf8f6", "x(cid:18)", "A\u25a1B"]) {
    assert.equal(isValidEditableLatex(broken), false, `expected rejection: ${broken}`);
  }
});

test("bare Unicode operator fragments are rejected like LaTeX ones", () => {
  // The raw PDF text layer returns operators as literal glyphs rather than
  // control words, so these reached the page without passing the LaTeX gate
  // and were emitted as empty math shells in a real 2000-page export.
  const shells = [
    "\u00b7\u00d7\u2192",
    "\u00b7\u2208",
    "\u2208\u2208",
    "\u2212\u2212",
    "\u2217\u2217",
    "\u223c\u223c",
    "\u2261\u2212\u2208\u2261",
    "\u21a6\u2192\u2208",
    "()()()()()()",
    "\u2212{}",
    "\u226a{}",
    "\u2229\u2208"
  ];
  for (const shell of shells) {
    assert.equal(
      hasMathOperand(shell),
      false,
      `expected bare-Unicode fragment ${JSON.stringify(shell)} to have no operand`
    );
  }
});

test("bare Unicode equations keep their operands", () => {
  // Same raw text layer, but these carry something to operate on and must
  // survive: rejecting them would silently delete real mathematics.
  const equations = [
    "a\u00b7(b\u00b7c)=(a\u00b7b)\u00b7c",
    "x\u2208A",
    "f:A\u2192B",
    "\u03b1\u00b7\u03b2",
    "Q\u22a4=Q\u22a4Q=I",
    "\u2211a",
    "\u2113_{2}",
    "n\u22651"
  ];
  for (const equation of equations) {
    assert.equal(
      hasMathOperand(equation),
      true,
      `expected ${JSON.stringify(equation)} to keep its operand`
    );
  }
});

test("collided prose is stripped without destroying the equation", () => {
  // A PDF text layer drops the spaces around a trailing comment, so the words
  // arrive fused to the formula.
  assert.equal(
    stripProse("=aa^{1}eistheidentityelement"),
    "=aa^{1}e"
  );
  assert.equal(
    stripProse("(b^{1}a^{1})(ab)=b^{1}(a^{1}(ab))associativity"),
    "(b^{1}a^{1})(ab)=b^{1}(a^{1}(ab))"
  );
  // "ba" is a product of two operands, not prose. Length alone cannot tell it
  // apart from "foralla", so an ambiguous run is left intact: keeping a stray
  // word is preferable to deleting part of a real equation.
  assert.equal(
    stripProse("ab=baforalla,bG."),
    "ab=baforalla,bG."
  );
  // Control words must never be treated as prose.
  assert.equal(stripProse("\\varnothing"), "\\varnothing");
  assert.equal(stripProse("x+y=z"), "x+y=z");
});

test("operator-only lines fold back into the sentence above them", () => {
  assert.deepEqual(
    rejoinOperatorLines(["The set of real numbers", "\u2208", "next paragraph"]),
    ["The set of real numbers \u2208", "next paragraph"]
  );
  // Markdown structure must stay intact, so nothing is absorbed into a
  // heading, a list item, or a math block.
  assert.deepEqual(
    rejoinOperatorLines(["## Heading", "\u2208", "body"]),
    ["## Heading", "\u2208", "body"]
  );
  assert.deepEqual(
    rejoinOperatorLines(["- list item", "\u2208", "body"]),
    ["- list item", "\u2208", "body"]
  );
  assert.deepEqual(
    rejoinOperatorLines(["$$", "\u2208", "$$"]),
    ["$$", "\u2208", "$$"]
  );
  // A line that carries an operand is a real formula and keeps its own line.
  assert.deepEqual(
    rejoinOperatorLines(["prose", "x+y=0", "more"]),
    ["prose", "x+y=0", "more"]
  );
  assert.deepEqual(
    rejoinOperatorLines(["prose", "\u2211", "more"]),
    ["prose", "\u2211", "more"]
  );
});

test("subsetted math fonts recover glyphs while prose fonts are untouched", () => {
  // Tables of contents often embed subsetted math fonts that keep the TeX
  // encoding but lose the family name the keyed maps rely on.
  assert.equal(repairCid("LWJXMB+CMEX7", 126), "\u20d7");
  assert.equal(repairCid("QWERTY+CMSY9", 67), "\u25c1");
  // Applying a TeX encoding to a text font would corrupt ordinary prose, so
  // non-math families are deliberately left alone.
  for (const fontname of ["ABCDEF+NimbusRomNo9L", "XYZ+Helvetica", "AAA+TimesNewRoman"]) {
    assert.equal(
      repairCid(fontname, 67),
      "(cid:67)",
      `expected ${fontname} to be left alone`
    );
  }
  // A keyed family still wins over the fallback.
  assert.equal(repairCid("ABCDEF+MSBM10", 126), "\u210f");
});

test("layout extraction timeout scales with document size", async () => {
  const { resolveLayoutTimeoutMs } = await import("../src/adapters/pdfLayoutExtractor.js");
  const floorMs = 20 * 60 * 1000;
  const ceilingMs = 6 * 60 * 60 * 1000;

  // An explicit budget from the caller always wins.
  assert.equal(await resolveLayoutTimeoutMs("does-not-matter", 1234), 1234);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-layout-timeout-"));
  try {
    const smallPdf = path.join(tempDir, "small.pdf");
    const largePdf = path.join(tempDir, "large.pdf");
    await writeFile(smallPdf, Buffer.alloc(1024 * 1024));
    await writeFile(largePdf, Buffer.alloc(30 * 1024 * 1024));

    const smallBudget = await resolveLayoutTimeoutMs(smallPdf);
    const largeBudget = await resolveLayoutTimeoutMs(largePdf);

    // A book-length PDF must get materially longer than the fixed floor that
    // previously applied to every input regardless of size.
    assert.ok(smallBudget >= floorMs, `${smallBudget} should be at least the floor`);
    assert.ok(largeBudget > smallBudget, "a larger document must get a larger budget");
    assert.ok(largeBudget <= ceilingMs, `${largeBudget} must stay within the ceiling`);

    // An unreadable size must not fail the extraction; it falls back to the floor.
    assert.equal(await resolveLayoutTimeoutMs(path.join(tempDir, "missing.pdf")), floorMs);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("glyph-map control words are never split by the boundary repair", () => {
  // The boundary repair exists to recover lost whitespace ("\\ged" -> "\\ge d").
  // Every command reachable from the glyph map has to be protected from it, or
  // adding a glyph silently corrupts output: "\\top" became "\\to p", which
  // turned the transpose of Q into a stray arrow followed by the letter p.
  const protectedCommands = [
    String.raw`Q^{\top}`,
    String.raw`Q_{\top}Q=I_{n}`,
    String.raw`a\neq b`,
    String.raw`x\mapsto y`,
    String.raw`\vec v`,
    String.raw`N\triangleleft G`
  ];
  for (const latex of protectedCommands) {
    assert.equal(
      normalizeReconstructedLatex(latex),
      latex,
      `expected ${latex} to survive the boundary repair intact`
    );
  }
  // The genuine repair still has to work, otherwise the protection is too broad.
  assert.equal(normalizeReconstructedLatex(String.raw`\ged`), String.raw`\ge d`);
  assert.equal(normalizeReconstructedLatex(String.raw`\ind`), String.raw`\in d`);
  // A longer valid command must not be truncated into a shorter prefix either.
  for (const latex of [String.raw`\lesssim`, String.raw`\subseteq`, String.raw`\notin`]) {
    assert.equal(normalizeReconstructedLatex(latex), latex);
  }
});

test("a sentence period is returned to the prose instead of rendering inside math", () => {
  // A display equation that ends a sentence absorbs the full stop from the same
  // baseline. Left inside the math it renders as a stray dot after the formula.
  const withPeriod = [
    ["[m][n]=[mn].", "[m][n]=[mn]"],
    [String.raw`gNg^{1}=N,forallgG.`, String.raw`gNg^{1}=N,forallgG`],
    [String.raw`{|}G_{|}=(G:H)_{|}H_{|}.`, String.raw`{|}G_{|}=(G:H)_{|}H_{|}`]
  ];
  for (const [input, expectedBody] of withPeriod) {
    assert.deepEqual(splitTrailingPeriod(input), [expectedBody, "."]);
  }
  // Decimals, ellipses, and ordinary equations must keep every character: the
  // period in "x=1.4" is part of the number, not sentence punctuation.
  for (const latex of ["x=1.4", "0.4", String.raw`\pi =3.14159`, "a_{1},...,a_{n}", String.raw`1,2,\ldots ,n`]) {
    assert.deepEqual(splitTrailingPeriod(latex), [latex, ""]);
  }
});

test("a standalone formula region never crashes the layout extractor", () => {
  // A single centred formula is the normal shape for a textbook display.  This
  // regression locks the grouping branch: it must recompute its damage state
  // locally rather than relying on a variable from an earlier classifier.
  const result = mergeSingleFormulaRegion({
    type: "formula",
    page: 1,
    bbox: [280, 100, 332, 114],
    text: "x",
    fontNames: ["CMMI10"],
    mathRatio: 1,
    signalCount: 1,
    editableMathCandidate: true,
    needsVisualFallback: false,
    displayMathLine: true,
    displayFragment: false,
    pageWidth: 612,
    _chars: [glyph("x", "CMMI10", 12, 300, 100)]
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "formula");
});

test("operator-only fragments are never promoted to centred display formulas", () => {
  // In prose such as Hom(E,E) o Hom(E,E) -> Hom(E,E), the relation glyphs may
  // be laid out near the centre while their operands remain in the text line.
  // Rendering only those glyphs as a display changes the mathematical meaning.
  assert.equal(hasDisplaySemantics(String.raw`\circ \times \to`, String.raw`\circ \times \to`, 3), false);
  assert.equal(hasDisplaySemantics(String.raw`{E}\circ\times\to`, String.raw`{E}\circ\times\to`, 3), false);
  assert.equal(hasDisplaySemantics(String.raw`g\circ f = h`, String.raw`g\circ f = h`, 2), true);
});

test("inline operator baseline rejoins its surrounding text instead of becoming a formula block", () => {
  const upper = "operation".split("").map((text, index) => glyph(text, "CMR12", 12, 212 + index * 5, 92));
  upper.push(glyph(":", "CMR12", 12, 271, 92));
  upper.push(..."Hom".split("").map((text, index) => glyph(text, "CMR12", 12, 279 + index * 6, 92)));
  const lower = "associative".split("").map((text, index) => glyph(text, "CMR12", 12, 240 + index * 5, 108));
  const operator = glyph("◦", "CMSY10", 10, 264, 102);
  const repaired = reattachInlineOperators([...upper, ...lower, operator]);
  const moved = repaired.find((char) => char.text === "◦");
  assert.equal(moved.top, 92);
});
