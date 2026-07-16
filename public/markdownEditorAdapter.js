class MarkdownEditorAdapter {
  constructor() {
    this.editorInstance = null;
    this.textareaEl = null;
    this.containerEl = null;
    this.isFallback = false;
    this.changeCallbacks = [];
    this.isReady = false;
    this.pendingValue = null;
    this.mathEditBubble = null;
  }

  async init(containerId, textareaId, initialValue, options = {}) {
    this.textareaEl = document.getElementById(textareaId);
    this.containerEl = document.getElementById(containerId);
    if (options.onChange) this.changeCallbacks.push(options.onChange);

    if (!this.containerEl) {
      this.activateReadableFallback(initialValue);
      return;
    }

    try {
      this.activateReadableFallback(initialValue);
    } catch (error) {
      console.error("Markdown editor fallback failed:", error);
      this.activateReadableFallback(initialValue);
    }
  }

  activateReadableFallback(value) {
    this.isFallback = true;
    if (this.textareaEl) {
      this.textareaEl.value = value || "";
      this.textareaEl.style.setProperty("display", "none", "important");
    }
    if (this.containerEl) this.containerEl.style.setProperty("display", "none", "important");
    window.renderMarkdownReadView?.();
    document.getElementById("markdownReadView")?.style.setProperty("display", "block", "important");
  }

  getValue() {
    if (this.isFallback) return this.textareaEl?.value || "";
    if (!this.isReady && this.pendingValue !== null) return this.pendingValue;
    if (!this.editorInstance || !this.isReady) return "";
    try {
      return this.editorInstance.action((ctx) => {
        const view = ctx.get(this.editorViewCtx);
        const serializer = ctx.get(this.serializerCtx);
        return serializer(view.state.doc);
      });
    } catch (error) {
      console.warn("Milkdown getValue failed:", error);
      return "";
    }
  }

  setValue(value) {
    const markdown = String(value ?? "");
    if (this.isFallback) {
      if (this.textareaEl) {
        this.textareaEl.value = markdown;
        this.changeCallbacks.forEach((callback) => callback(markdown));
      }
      return;
    }
    if (!this.editorInstance || !this.isReady) {
      this.pendingValue = markdown;
      return;
    }
    try {
      this.editorInstance.action(this.replaceAll(markdown));
    } catch (error) {
      console.warn("Milkdown setValue failed:", error);
      this.pendingValue = markdown;
    }
  }

  insertValue(value) {
    const insertion = String(value ?? "");
    if (this.isFallback) {
      const editor = this.textareaEl;
      if (!editor) return;
      const position = editor.selectionStart;
      editor.value = editor.value.slice(0, position) + insertion + editor.value.slice(position);
      editor.selectionStart = editor.selectionEnd = position + insertion.length;
      this.changeCallbacks.forEach((callback) => callback(editor.value));
      return;
    }
    if (!this.editorInstance || !this.isReady) {
      this.pendingValue = `${this.pendingValue || ""}${insertion}`;
      return;
    }
    try {
      this.editorInstance.action(this.insert(insertion));
    } catch (error) {
      console.warn("Milkdown insertValue failed:", error);
      this.pendingValue = `${this.pendingValue || ""}${insertion}`;
    }
  }

  on(eventName, callback) {
    if (eventName === "change") this.changeCallbacks.push(callback);
  }

  focusLine(lineIndex) {
    if (!this.editorInstance || !this.isReady) return;
    try {
      this.editorInstance.action((ctx) => {
        const view = ctx.get(this.editorViewCtx);
        view.focus();
        const lines = this.getValue().split("\n");
        const offset = lines.slice(0, Math.max(0, lineIndex)).join("\n").length + (lineIndex > 0 ? 1 : 0);
        const targetPos = Math.max(0, Math.min(offset, view.state.doc.content.size));
        const selection = this.TextSelection.near(view.state.doc.resolve(targetPos));
        view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
      });
    } catch (error) {
      console.warn("Milkdown focusLine failed:", error);
    }
  }

  setupMathFormulaInteractiveEditor() {
    if (!this.containerEl || !this.editorInstance) return;
    this.containerEl.addEventListener("click", (event) => {
      const mathElement = event.target.closest('[data-type="math_inline"], [data-type="math_block"]');
      if (!mathElement) return;
      event.preventDefault();
      event.stopPropagation();

      this.editorInstance.action((ctx) => {
        const view = ctx.get(this.editorViewCtx);
        let position;
        try {
          position = view.posAtDOM(mathElement, 0);
        } catch {
          return;
        }
        const node = view.state.doc.nodeAt(position);
        if (!node) return;
        const isBlock = mathElement.dataset.type === "math_block";
        const currentValue = isBlock ? String(node.attrs.value || "") : node.textContent;
        this.showMathEditBubble(mathElement, currentValue, (nextValue) => {
          const trimmedValue = String(nextValue || "").trim();
          if (!trimmedValue) return;
          let transaction = view.state.tr;
          if (isBlock) {
            transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, value: trimmedValue });
          } else {
            const replacement = view.state.schema.nodes.math_inline.create(null, view.state.schema.text(trimmedValue));
            transaction = transaction.replaceWith(position, position + node.nodeSize, replacement);
          }
          view.dispatch(transaction.scrollIntoView());
          view.focus();
        });
      });
    });
  }

  showMathEditBubble(anchor, value, onApply) {
    this.mathEditBubble?.remove();
    const bubble = document.createElement("div");
    bubble.className = "milkdown-math-editor";
    bubble.innerHTML = '<textarea aria-label="Edit LaTeX formula" spellcheck="false"></textarea><div><button type="button" data-action="apply">Apply</button><button type="button" data-action="cancel" class="secondary">Cancel</button></div>';
    const textarea = bubble.querySelector("textarea");
    textarea.value = value;
    document.body.appendChild(bubble);
    this.mathEditBubble = bubble;

    const rect = anchor.getBoundingClientRect();
    bubble.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 460))}px`;
    bubble.style.top = `${Math.min(window.innerHeight - 170, rect.bottom + 8)}px`;

    const close = () => {
      bubble.remove();
      if (this.mathEditBubble === bubble) this.mathEditBubble = null;
    };
    bubble.querySelector('[data-action="apply"]').addEventListener("click", () => {
      onApply(textarea.value);
      close();
    });
    bubble.querySelector('[data-action="cancel"]').addEventListener("click", close);
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        onApply(textarea.value);
        close();
      }
    });
    textarea.focus();
    textarea.select();
  }

  destroy() {
    this.mathEditBubble?.remove();
    this.mathEditBubble = null;
    if (this.editorInstance) {
      try {
        if (this.containerEl) this.containerEl.innerHTML = "";
      } catch (error) {
        console.warn("Milkdown destroy failed:", error);
      }
      this.editorInstance = null;
    }
    this.isFallback = false;
    this.isReady = false;
    this.pendingValue = null;
    this.changeCallbacks = [];
  }
}

window.MarkdownEditorAdapter = MarkdownEditorAdapter;
