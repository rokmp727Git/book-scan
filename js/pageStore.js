/**
 * Reactive Page Store & State Management
 * Maintains captured book pages, ordering, filters, OCR transcripts, and change subscriptions.
 */

export class PageStore {
  constructor() {
    this.pages = [];
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify() {
    this.listeners.forEach(fn => fn(this.pages));
  }

  /**
   * Add a newly captured page
   */
  addPage(originalDataUrl, enhancedDataUrl = null, options = {}) {
    const page = {
      id: 'page_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      pageNumber: this.pages.length + 1,
      originalDataUrl,
      enhancedDataUrl: enhancedDataUrl || originalDataUrl,
      filter: options.filter || 'original',
      rotation: options.rotation || 0,
      timestamp: Date.now(),
      ocrStatus: 'idle', // 'idle' | 'processing' | 'done' | 'failed'
      ocrText: '',
      ocrConfidence: 0,
    };

    this.pages.push(page);
    this._reindexPageNumbers();
    this._notify();
    return page;
  }

  /**
   * Remove page by ID
   */
  removePage(pageId) {
    this.pages = this.pages.filter(p => p.id !== pageId);
    this._reindexPageNumbers();
    this._notify();
  }

  /**
   * Reorder page from sourceIndex to targetIndex (for drag and drop)
   */
  reorderPages(sourceIndex, targetIndex) {
    if (sourceIndex < 0 || sourceIndex >= this.pages.length ||
        targetIndex < 0 || targetIndex >= this.pages.length ||
        sourceIndex === targetIndex) {
      return;
    }

    const [movedItem] = this.pages.splice(sourceIndex, 1);
    this.pages.splice(targetIndex, 0, movedItem);
    this._reindexPageNumbers();
    this._notify();
  }

  /**
   * Move page up/down by 1 position
   */
  movePage(pageId, direction) {
    const index = this.pages.findIndex(p => p.id === pageId);
    if (index === -1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    this.reorderPages(index, targetIndex);
  }

  /**
   * Update properties of a page
   */
  updatePage(pageId, patch) {
    const page = this.pages.find(p => p.id === pageId);
    if (!page) return;

    Object.assign(page, patch);
    this._notify();
    return page;
  }

  /**
   * Clear all pages
   */
  clearAll() {
    this.pages = [];
    this._notify();
  }

  getPages() {
    return [...this.pages];
  }

  getPage(pageId) {
    return this.pages.find(p => p.id === pageId);
  }

  _reindexPageNumbers() {
    this.pages.forEach((p, idx) => {
      p.pageNumber = idx + 1;
    });
  }
}
