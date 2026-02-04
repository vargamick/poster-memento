/**
 * Processing Manager
 * Handles poster image scanning, previewing, and batch processing
 */

import { createAPI } from './api.js';

export class ProcessingManager {
  constructor() {
    this.api = createAPI();
    this.files = [];
    this.selectedFiles = new Set();
    this.currentPage = 1;
    this.totalFiles = 0;
    this.limit = 50;
    this.hasMore = false;
    this.isProcessing = false;
    this.currentPreviewEntity = null;
    this.processingAborted = false;

    // Folder browser state
    this.folderBrowserCurrentPath = null;
    this.folderBrowserParentPath = null;
    this.folderBrowserDirectories = [];

    this.elements = {};
    this.initialized = false;
  }

  /**
   * Initialize the processing manager
   */
  async init() {
    if (this.initialized) return;

    this.cacheElements();
    this.bindEvents();
    await this.loadVisionModels();

    this.initialized = true;
    console.log('ProcessingManager initialized');
  }

  /**
   * Cache DOM element references
   */
  cacheElements() {
    this.elements = {
      // Source section
      sourcePath: document.getElementById('source-path'),
      browseBtn: document.getElementById('browse-btn'),
      scanBtn: document.getElementById('scan-btn'),
      refreshBtn: document.getElementById('refresh-btn'),
      totalImages: document.getElementById('total-images'),
      unprocessedCount: document.getElementById('unprocessed-count'),

      // Folder browser modal
      folderBrowserModal: document.getElementById('folder-browser-modal'),
      folderBrowserClose: document.getElementById('folder-browser-close'),
      folderBrowserCurrentPath: document.getElementById('folder-browser-current-path'),
      folderBrowserUpBtn: document.getElementById('folder-browser-up-btn'),
      folderBrowserHomeBtn: document.getElementById('folder-browser-home-btn'),
      folderBrowserLoading: document.getElementById('folder-browser-loading'),
      folderBrowserError: document.getElementById('folder-browser-error'),
      folderBrowserErrorMessage: document.getElementById('folder-browser-error-message'),
      folderBrowserList: document.getElementById('folder-browser-list'),
      folderBrowserImageCount: document.getElementById('folder-browser-image-count'),
      folderBrowserSelectBtn: document.getElementById('folder-browser-select-btn'),
      folderBrowserCancelBtn: document.getElementById('folder-browser-cancel-btn'),

      // Config section
      modelSelect: document.getElementById('model-select'),
      batchSizeSelect: document.getElementById('batch-size-select'),
      skipExisting: document.getElementById('skip-existing'),
      storeImages: document.getElementById('store-images'),

      // File browser
      selectAllBtn: document.getElementById('select-all-btn'),
      deselectAllBtn: document.getElementById('deselect-all-btn'),
      selectedCount: document.getElementById('selected-count'),
      fileList: document.getElementById('file-list'),
      filesPrevBtn: document.getElementById('files-prev-btn'),
      filesNextBtn: document.getElementById('files-next-btn'),
      filesPageInfo: document.getElementById('files-page-info'),

      // Actions
      previewBtn: document.getElementById('preview-btn'),
      processBtn: document.getElementById('process-btn'),
      processAllBtn: document.getElementById('process-all-btn'),

      // Progress
      progressSection: document.getElementById('progress-section'),
      progressFill: document.getElementById('progress-fill'),
      progressPercent: document.getElementById('progress-percent'),
      progressProcessed: document.getElementById('progress-processed'),
      progressSucceeded: document.getElementById('progress-succeeded'),
      progressFailed: document.getElementById('progress-failed'),
      progressLog: document.getElementById('progress-log'),
      cancelProcessingBtn: document.getElementById('cancel-processing-btn'),

      // Preview modal
      previewModal: document.getElementById('preview-modal'),
      previewModalClose: document.getElementById('preview-modal-close'),
      previewImage: document.getElementById('preview-image'),
      previewLoading: document.getElementById('preview-loading'),
      previewData: document.getElementById('preview-data'),
      previewError: document.getElementById('preview-error'),
      previewErrorMessage: document.getElementById('preview-error-message'),
      previewTime: document.getElementById('preview-time'),
      previewModel: document.getElementById('preview-model'),
      previewCommitBtn: document.getElementById('preview-commit-btn'),
      previewCloseBtn: document.getElementById('preview-close-btn')
    };
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Source controls
    this.elements.browseBtn?.addEventListener('click', () => this.openFolderBrowser());
    this.elements.scanBtn?.addEventListener('click', () => this.scanFolder());
    this.elements.refreshBtn?.addEventListener('click', () => this.scanFolder());

    // Folder browser modal
    this.elements.folderBrowserClose?.addEventListener('click', () => this.closeFolderBrowser());
    this.elements.folderBrowserCancelBtn?.addEventListener('click', () => this.closeFolderBrowser());
    this.elements.folderBrowserSelectBtn?.addEventListener('click', () => this.selectFolder());
    this.elements.folderBrowserUpBtn?.addEventListener('click', () => this.navigateToParent());
    this.elements.folderBrowserHomeBtn?.addEventListener('click', () => this.navigateToHome());
    this.elements.folderBrowserModal?.addEventListener('click', (e) => {
      if (e.target === this.elements.folderBrowserModal) this.closeFolderBrowser();
    });
    this.elements.folderBrowserList?.addEventListener('click', (e) => this.handleFolderClick(e));
    this.elements.folderBrowserList?.addEventListener('dblclick', (e) => this.handleFolderDoubleClick(e));

    // File selection
    this.elements.selectAllBtn?.addEventListener('click', () => this.selectAll());
    this.elements.deselectAllBtn?.addEventListener('click', () => this.deselectAll());

    // Pagination
    this.elements.filesPrevBtn?.addEventListener('click', () => this.prevPage());
    this.elements.filesNextBtn?.addEventListener('click', () => this.nextPage());

    // Actions
    this.elements.previewBtn?.addEventListener('click', () => this.previewSelected());
    this.elements.processBtn?.addEventListener('click', () => this.processSelected());
    this.elements.processAllBtn?.addEventListener('click', () => this.processAll());
    this.elements.cancelProcessingBtn?.addEventListener('click', () => this.cancelProcessing());

    // Preview modal
    this.elements.previewModalClose?.addEventListener('click', () => this.closePreviewModal());
    this.elements.previewCloseBtn?.addEventListener('click', () => this.closePreviewModal());
    this.elements.previewCommitBtn?.addEventListener('click', () => this.commitPreview());
    this.elements.previewModal?.addEventListener('click', (e) => {
      if (e.target === this.elements.previewModal) this.closePreviewModal();
    });

    // File list click delegation
    this.elements.fileList?.addEventListener('click', (e) => this.handleFileListClick(e));
    this.elements.fileList?.addEventListener('change', (e) => this.handleFileCheckboxChange(e));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.elements.previewModal?.classList.contains('hidden')) {
        this.closePreviewModal();
      }
    });
  }

  /**
   * Load available vision models
   */
  async loadVisionModels() {
    try {
      const result = await this.api.getVisionModels();
      const models = result.data?.models || [];
      const defaultModel = result.data?.current || result.data?.default;

      this.elements.modelSelect.innerHTML = models.map(model => `
        <option value="${this.escapeHtml(model.key)}" ${model.key === defaultModel ? 'selected' : ''}>
          ${this.escapeHtml(model.model)} (${this.escapeHtml(model.provider)})
        </option>
      `).join('');
    } catch (error) {
      console.error('Failed to load vision models:', error);
      this.elements.modelSelect.innerHTML = '<option value="">Failed to load models</option>';
    }
  }

  /**
   * Scan the source folder for images
   */
  async scanFolder() {
    const sourcePath = this.elements.sourcePath?.value || './SourceImages';

    this.elements.scanBtn.disabled = true;
    this.elements.scanBtn.textContent = 'Scanning...';

    try {
      const offset = (this.currentPage - 1) * this.limit;
      const result = await this.api.scanPosters({
        sourcePath,
        offset,
        limit: this.limit
      });

      if (result.data?.success) {
        this.files = result.data.files || [];
        this.totalFiles = result.data.totalFiles || 0;
        this.hasMore = result.data.hasMore || false;

        this.elements.totalImages.textContent = this.totalFiles;
        this.updateUnprocessedCount();
        this.renderFileList();
        this.updatePagination();
        this.updateActionButtons();
      } else {
        this.showError('Scan failed: ' + (result.data?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Scan error:', error);
      this.showError('Failed to scan folder: ' + error.message);
    } finally {
      this.elements.scanBtn.disabled = false;
      this.elements.scanBtn.textContent = 'Scan Folder';
    }
  }

  /**
   * Update unprocessed count (via processing status)
   */
  async updateUnprocessedCount() {
    try {
      const result = await this.api.getProcessingStatus();
      const processed = result.data?.processedCount || 0;
      const unprocessed = this.totalFiles - processed;
      this.elements.unprocessedCount.textContent = unprocessed >= 0 ? unprocessed : '--';
    } catch (error) {
      this.elements.unprocessedCount.textContent = '--';
    }
  }

  /**
   * Render the file list
   */
  renderFileList() {
    if (this.files.length === 0) {
      this.elements.fileList.innerHTML = `
        <div class="file-list-empty">
          <p>No images found</p>
          <p>Check the source path and try again</p>
        </div>
      `;
      return;
    }

    this.elements.fileList.innerHTML = this.files.map(file => `
      <div class="file-item ${this.selectedFiles.has(file.path) ? 'selected' : ''}" data-path="${this.escapeHtml(file.path)}">
        <input type="checkbox" ${this.selectedFiles.has(file.path) ? 'checked' : ''}>
        <div class="file-info">
          <div class="filename">${this.escapeHtml(file.filename)}</div>
          <div class="file-meta">${this.formatFileSize(file.sizeBytes)} • ${this.formatDate(file.modifiedAt)}</div>
        </div>
      </div>
    `).join('');
  }

  /**
   * Handle click on file list item
   */
  handleFileListClick(e) {
    const fileItem = e.target.closest('.file-item');
    if (!fileItem) return;

    // Don't toggle if clicking directly on checkbox
    if (e.target.type === 'checkbox') return;

    const path = fileItem.dataset.path;
    const checkbox = fileItem.querySelector('input[type="checkbox"]');

    if (this.selectedFiles.has(path)) {
      this.selectedFiles.delete(path);
      fileItem.classList.remove('selected');
      checkbox.checked = false;
    } else {
      this.selectedFiles.add(path);
      fileItem.classList.add('selected');
      checkbox.checked = true;
    }

    this.updateSelectionCount();
    this.updateActionButtons();
  }

  /**
   * Handle checkbox change
   */
  handleFileCheckboxChange(e) {
    if (e.target.type !== 'checkbox') return;

    const fileItem = e.target.closest('.file-item');
    if (!fileItem) return;

    const path = fileItem.dataset.path;

    if (e.target.checked) {
      this.selectedFiles.add(path);
      fileItem.classList.add('selected');
    } else {
      this.selectedFiles.delete(path);
      fileItem.classList.remove('selected');
    }

    this.updateSelectionCount();
    this.updateActionButtons();
  }

  /**
   * Select all files
   */
  selectAll() {
    this.files.forEach(file => this.selectedFiles.add(file.path));
    this.renderFileList();
    this.updateSelectionCount();
    this.updateActionButtons();
  }

  /**
   * Deselect all files
   */
  deselectAll() {
    this.selectedFiles.clear();
    this.renderFileList();
    this.updateSelectionCount();
    this.updateActionButtons();
  }

  /**
   * Update selection count display
   */
  updateSelectionCount() {
    this.elements.selectedCount.textContent = this.selectedFiles.size;
  }

  /**
   * Update action button states
   */
  updateActionButtons() {
    const hasSelection = this.selectedFiles.size > 0;
    const hasFiles = this.totalFiles > 0;

    this.elements.previewBtn.disabled = this.selectedFiles.size !== 1;
    this.elements.processBtn.disabled = !hasSelection;
    this.elements.processAllBtn.disabled = !hasFiles;
  }

  /**
   * Update pagination controls
   */
  updatePagination() {
    const totalPages = Math.ceil(this.totalFiles / this.limit) || 1;

    this.elements.filesPageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
    this.elements.filesPrevBtn.disabled = this.currentPage <= 1;
    this.elements.filesNextBtn.disabled = !this.hasMore;
  }

  /**
   * Go to previous page
   */
  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.scanFolder();
    }
  }

  /**
   * Go to next page
   */
  nextPage() {
    if (this.hasMore) {
      this.currentPage++;
      this.scanFolder();
    }
  }

  /**
   * Preview selected image
   */
  async previewSelected() {
    if (this.selectedFiles.size !== 1) return;

    const imagePath = Array.from(this.selectedFiles)[0];
    const modelKey = this.elements.modelSelect?.value || undefined;

    // Show modal with loading state
    this.showPreviewModal(imagePath);

    try {
      const result = await this.api.previewPoster(imagePath, modelKey);

      if (result.data?.success && result.data?.entity) {
        this.currentPreviewEntity = result.data.entity;
        this.renderPreviewData(result.data);
      } else {
        this.showPreviewError(result.data?.error || 'Extraction failed');
      }
    } catch (error) {
      console.error('Preview error:', error);
      this.showPreviewError(error.message);
    }
  }

  /**
   * Show preview modal with loading state
   */
  showPreviewModal(imagePath) {
    // Set image source to file path (will work if served correctly)
    this.elements.previewImage.src = '';
    this.elements.previewImage.alt = 'Loading...';

    // Show loading state
    this.elements.previewLoading.classList.remove('hidden');
    this.elements.previewData.classList.add('hidden');
    this.elements.previewError.classList.add('hidden');
    this.elements.previewCommitBtn.disabled = true;
    this.elements.previewTime.textContent = '--';
    this.elements.previewModel.textContent = '--';

    // Show modal
    this.elements.previewModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Render preview extraction data
   */
  renderPreviewData(data) {
    const entity = data.entity;

    this.elements.previewLoading.classList.add('hidden');
    this.elements.previewData.classList.remove('hidden');
    this.elements.previewCommitBtn.disabled = false;
    this.elements.previewTime.textContent = data.processingTimeMs || '--';
    this.elements.previewModel.textContent = data.modelUsed || '--';

    const fields = [
      { label: 'Poster Type', value: entity.poster_type },
      { label: 'Title', value: entity.title },
      { label: 'Headliner', value: entity.headliner },
      { label: 'Supporting Acts', value: entity.supporting_acts?.join(', ') },
      { label: 'Venue', value: entity.venue_name },
      { label: 'City', value: entity.city },
      { label: 'State', value: entity.state },
      { label: 'Event Date', value: entity.event_date },
      { label: 'Year', value: entity.year },
      { label: 'Ticket Price', value: entity.ticket_price },
      { label: 'Door Time', value: entity.door_time },
      { label: 'Show Time', value: entity.show_time },
      { label: 'Age Restriction', value: entity.age_restriction },
      { label: 'Visual Style', value: entity.visual_elements?.style }
    ];

    this.elements.previewData.innerHTML = fields.map(field => `
      <div class="preview-field">
        <div class="field-label">${this.escapeHtml(field.label)}</div>
        <div class="field-value ${!field.value ? 'empty' : ''}">${field.value ? this.escapeHtml(String(field.value)) : 'Not detected'}</div>
      </div>
    `).join('');
  }

  /**
   * Show preview error
   */
  showPreviewError(message) {
    this.elements.previewLoading.classList.add('hidden');
    this.elements.previewData.classList.add('hidden');
    this.elements.previewError.classList.remove('hidden');
    this.elements.previewErrorMessage.textContent = message;
    this.elements.previewCommitBtn.disabled = true;
  }

  /**
   * Close preview modal
   */
  closePreviewModal() {
    this.elements.previewModal.classList.add('hidden');
    document.body.style.overflow = '';
    this.currentPreviewEntity = null;
  }

  /**
   * Commit previewed entity to database
   */
  async commitPreview() {
    if (!this.currentPreviewEntity) return;

    this.elements.previewCommitBtn.disabled = true;
    this.elements.previewCommitBtn.textContent = 'Committing...';

    try {
      const result = await this.api.commitPoster(this.currentPreviewEntity, this.elements.storeImages.checked);

      if (result.data?.success) {
        this.addLogEntry('Committed: ' + this.currentPreviewEntity.name, 'success');
        this.closePreviewModal();
        await this.updateUnprocessedCount();
      } else {
        this.showPreviewError('Commit failed: ' + (result.data?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Commit error:', error);
      this.showPreviewError('Commit failed: ' + error.message);
    } finally {
      this.elements.previewCommitBtn.disabled = false;
      this.elements.previewCommitBtn.textContent = 'Commit to Database';
    }
  }

  /**
   * Process selected images
   */
  async processSelected() {
    if (this.selectedFiles.size === 0) return;

    const filePaths = Array.from(this.selectedFiles);
    await this.startProcessing(filePaths);
  }

  /**
   * Process all unprocessed images
   */
  async processAll() {
    await this.startProcessing(null); // null means process from source directory
  }

  /**
   * Start batch processing
   */
  async startProcessing(filePaths) {
    this.isProcessing = true;
    this.processingAborted = false;

    // Show progress section
    this.elements.progressSection.classList.remove('hidden');
    this.resetProgress();

    // Disable action buttons
    this.elements.previewBtn.disabled = true;
    this.elements.processBtn.disabled = true;
    this.elements.processAllBtn.disabled = true;

    const batchSize = parseInt(this.elements.batchSizeSelect.value) || 5;
    const modelKey = this.elements.modelSelect?.value || undefined;
    const skipIfExists = this.elements.skipExisting.checked;
    const storeImages = this.elements.storeImages.checked;

    let offset = 0;
    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let hasMore = true;

    this.addLogEntry('Starting processing...', 'info');

    try {
      while (hasMore && !this.processingAborted) {
        const options = {
          batchSize,
          offset,
          skipIfExists,
          storeImages,
          modelKey
        };

        if (filePaths) {
          options.filePaths = filePaths.slice(offset, offset + batchSize);
          hasMore = offset + batchSize < filePaths.length;
        }

        const result = await this.api.processPosters(options);
        const data = result.data;

        if (data) {
          totalProcessed += data.processed || 0;
          totalSucceeded += data.succeeded || 0;
          totalFailed += data.failed || 0;
          hasMore = data.hasMore && !filePaths;

          // Update progress UI
          const total = filePaths ? filePaths.length : this.totalFiles;
          const percent = Math.round((totalProcessed / total) * 100);

          this.updateProgress(percent, totalProcessed, totalSucceeded, totalFailed);

          // Log individual results
          data.entities?.forEach(entity => {
            if (entity.success) {
              this.addLogEntry(`✓ ${entity.title || entity.name}`, 'success');
            } else {
              this.addLogEntry(`✗ ${entity.name}: ${entity.error}`, 'error');
            }
          });

          offset += batchSize;
        } else {
          this.addLogEntry('Batch returned no data', 'error');
          break;
        }
      }

      if (this.processingAborted) {
        this.addLogEntry('Processing cancelled by user', 'info');
      } else {
        this.addLogEntry(`Processing complete: ${totalSucceeded} succeeded, ${totalFailed} failed`, 'info');
      }
    } catch (error) {
      console.error('Processing error:', error);
      this.addLogEntry('Error: ' + error.message, 'error');
    } finally {
      this.isProcessing = false;
      this.updateActionButtons();
      await this.updateUnprocessedCount();
    }
  }

  /**
   * Cancel processing
   */
  cancelProcessing() {
    this.processingAborted = true;
    this.elements.cancelProcessingBtn.disabled = true;
    this.elements.cancelProcessingBtn.textContent = 'Cancelling...';
  }

  /**
   * Reset progress display
   */
  resetProgress() {
    this.elements.progressFill.style.width = '0%';
    this.elements.progressPercent.textContent = '0%';
    this.elements.progressProcessed.textContent = '0';
    this.elements.progressSucceeded.textContent = '0';
    this.elements.progressFailed.textContent = '0';
    this.elements.progressLog.innerHTML = '';
    this.elements.cancelProcessingBtn.disabled = false;
    this.elements.cancelProcessingBtn.textContent = 'Cancel';
  }

  /**
   * Update progress display
   */
  updateProgress(percent, processed, succeeded, failed) {
    this.elements.progressFill.style.width = `${percent}%`;
    this.elements.progressPercent.textContent = `${percent}%`;
    this.elements.progressProcessed.textContent = processed;
    this.elements.progressSucceeded.textContent = succeeded;
    this.elements.progressFailed.textContent = failed;
  }

  /**
   * Add log entry
   */
  addLogEntry(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    this.elements.progressLog.appendChild(entry);
    this.elements.progressLog.scrollTop = this.elements.progressLog.scrollHeight;
  }

  /**
   * Show error message
   */
  showError(message) {
    console.error(message);
    this.addLogEntry(message, 'error');
  }

  /**
   * Format file size
   */
  formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    return `${bytes.toFixed(1)} ${units[i]}`;
  }

  /**
   * Format date
   */
  formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  }

  /**
   * Open folder browser modal
   */
  async openFolderBrowser() {
    this.elements.folderBrowserModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Load directories starting from current source path or default
    const currentPath = this.elements.sourcePath?.value || './SourceImages';
    await this.loadDirectories(currentPath);
  }

  /**
   * Close folder browser modal
   */
  closeFolderBrowser() {
    this.elements.folderBrowserModal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  /**
   * Load directories for the folder browser
   */
  async loadDirectories(path = null) {
    this.showFolderBrowserLoading(true);
    this.hideFolderBrowserError();

    try {
      const params = path ? `?path=${encodeURIComponent(path)}` : '';
      const response = await fetch(`/api/v1/posters/directories${params}`, {
        headers: {
          'X-API-Key': 'posters-api-key-2024'
        }
      });
      const result = await response.json();

      if (!response.ok || !result.data?.success) {
        throw new Error(result.error || result.data?.error || 'Failed to load directories');
      }

      this.folderBrowserCurrentPath = result.data.currentPath;
      this.folderBrowserParentPath = result.data.parentPath;
      this.folderBrowserDirectories = result.data.directories || [];

      this.renderFolderBrowserList();
      this.updateFolderBrowserUI(result.data);
    } catch (error) {
      console.error('Failed to load directories:', error);
      this.showFolderBrowserError(error.message);
    } finally {
      this.showFolderBrowserLoading(false);
    }
  }

  /**
   * Render the folder browser list
   */
  renderFolderBrowserList() {
    if (this.folderBrowserDirectories.length === 0) {
      this.elements.folderBrowserList.innerHTML = `
        <div class="folder-browser-list-empty">
          <p>No subdirectories found</p>
        </div>
      `;
      return;
    }

    this.elements.folderBrowserList.innerHTML = this.folderBrowserDirectories.map(dir => `
      <div class="folder-item" data-path="${this.escapeHtml(dir.path)}">
        <span class="folder-icon">📁</span>
        <span class="folder-name">${this.escapeHtml(dir.name)}</span>
        <span class="folder-enter">→</span>
      </div>
    `).join('');
  }

  /**
   * Update folder browser UI elements
   */
  updateFolderBrowserUI(data) {
    // Update current path display
    this.elements.folderBrowserCurrentPath.textContent = data.currentPath;
    this.elements.folderBrowserCurrentPath.title = data.currentPath;

    // Update parent button state
    this.elements.folderBrowserUpBtn.disabled = !data.parentPath;

    // Update image count
    const imageCount = data.imageCount || 0;
    this.elements.folderBrowserImageCount.textContent = `${imageCount} image${imageCount !== 1 ? 's' : ''} in this folder`;
  }

  /**
   * Handle click on folder item (single click to select)
   */
  handleFolderClick(e) {
    const folderItem = e.target.closest('.folder-item');
    if (!folderItem) return;

    // Remove selection from other items
    this.elements.folderBrowserList.querySelectorAll('.folder-item').forEach(item => {
      item.classList.remove('selected');
    });

    // Select this item
    folderItem.classList.add('selected');
  }

  /**
   * Handle double-click on folder item (navigate into)
   */
  handleFolderDoubleClick(e) {
    const folderItem = e.target.closest('.folder-item');
    if (!folderItem) return;

    const path = folderItem.dataset.path;
    if (path) {
      this.loadDirectories(path);
    }
  }

  /**
   * Navigate to parent directory
   */
  navigateToParent() {
    if (this.folderBrowserParentPath) {
      this.loadDirectories(this.folderBrowserParentPath);
    }
  }

  /**
   * Navigate to home/default directory
   */
  navigateToHome() {
    this.loadDirectories(null); // null will use the default path
  }

  /**
   * Select the current folder
   */
  selectFolder() {
    if (this.folderBrowserCurrentPath) {
      this.elements.sourcePath.value = this.folderBrowserCurrentPath;
      this.closeFolderBrowser();

      // Auto-scan after selecting
      this.scanFolder();
    }
  }

  /**
   * Show/hide folder browser loading state
   */
  showFolderBrowserLoading(show) {
    this.elements.folderBrowserLoading.classList.toggle('hidden', !show);
    this.elements.folderBrowserList.classList.toggle('hidden', show);
  }

  /**
   * Show folder browser error
   */
  showFolderBrowserError(message) {
    this.elements.folderBrowserError.classList.remove('hidden');
    this.elements.folderBrowserErrorMessage.textContent = message;
    this.elements.folderBrowserList.classList.add('hidden');
  }

  /**
   * Hide folder browser error
   */
  hideFolderBrowserError() {
    this.elements.folderBrowserError.classList.add('hidden');
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Create and export singleton instance
export const processingManager = new ProcessingManager();

// Auto-initialize when processing tab is shown (handled by app.js)
