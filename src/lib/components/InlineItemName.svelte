<script lang="ts">
	/** Single always-present node: contenteditable toggles; avoids layout swap between text and input. */
	let {
		name,
		itemId = null,
		editingEnabled,
		class: className = '',
		style: styleProp = '',
		onCommit,
		hostEl = $bindable(null),
		onVerticalNavigate = null,
		onEnterNewBelow = null,
		onExitEmpty = null,
	}: {
		name: string;
		itemId?: string | null;
		editingEnabled: boolean;
		class?: string;
		style?: string;
		onCommit: (next: string) => void;
		hostEl?: HTMLElement | null;
		onVerticalNavigate?: ((dir: -1 | 1) => void) | null;
		onEnterNewBelow?: ((trimmed: string) => void) | null;
		onExitEmpty?: (() => void) | null;
	} = $props();

	let focused = $state(false);

	$effect(() => {
		if (!hostEl || focused) return;
		if (hostEl.textContent !== name) hostEl.textContent = name;
	});

	function placeCaretAtEnd() {
		if (!hostEl) return;
		const range = document.createRange();
		const sel = window.getSelection();
		range.selectNodeContents(hostEl);
		range.collapse(false);
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	function commitFromDom() {
		if (!hostEl) return;
		const raw = hostEl.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		if (raw === '' || raw === name) {
			hostEl.textContent = name;
			return;
		}
		onCommit(raw);
	}

	function handleFocus() {
		focused = true;
		if (!hostEl || !editingEnabled) return;
		requestAnimationFrame(() => {
			if (!hostEl || document.activeElement !== hostEl) return;
			placeCaretAtEnd();
		});
	}

	function handleBlur() {
		focused = false;
		if (!hostEl) return;
		const raw = hostEl.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		// Empty line while editing: remove row via parent (no revert — Escape only blurs without restoring DOM).
		if (editingEnabled && onExitEmpty && raw === '') {
			onExitEmpty();
			return;
		}
		commitFromDom();
	}

	function handleKeydown(e: KeyboardEvent) {
		// List page wires vertical navigation between rows in edit mode.
		if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && editingEnabled && onVerticalNavigate) {
			e.preventDefault();
			onVerticalNavigate(e.key === 'ArrowUp' ? -1 : 1);
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			// With onEnterNewBelow: commit current line (if any) and insert empty row — parent removes row if text stayed empty.
			if (editingEnabled && onEnterNewBelow) {
				const raw = hostEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
				onEnterNewBelow(raw);
				return;
			}
			(hostEl as HTMLElement | undefined)?.blur();
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			// Blur only — does not revert visible text (matches product expectation).
			(hostEl as HTMLElement | undefined)?.blur();
		}
	}

	function handlePaste(e: ClipboardEvent) {
		if (!editingEnabled) return;
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain').replace(/\r?\n/g, ' ') ?? '';
		document.execCommand('insertText', false, text);
	}
</script>

<span
	bind:this={hostEl}
	data-inline-item-name
	data-item-editor={editingEnabled && itemId ? itemId : undefined}
	role={editingEnabled ? 'textbox' : undefined}
	tabindex={editingEnabled ? 0 : -1}
	contenteditable={editingEnabled}
	class={className}
	style={styleProp}
	onfocus={handleFocus}
	onblur={handleBlur}
	onkeydown={handleKeydown}
	onpaste={handlePaste}
	onbeforeinput={(e) => {
		if (!editingEnabled) return;
		if (e.inputType === 'insertLineBreak') e.preventDefault();
	}}
></span>
