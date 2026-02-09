/**
 * Processing Manager - Session-Based Workflow
 *
 * Flow:
 * 1. Create or select a session (staging area)
 * 2. Upload images to the session
 * 3. View and select images in the session
 * 4. Process selected images (moves to live folder on success)
 */

class ProcessingManager {
  constructor() {
    // Session state
    this.sessions = [];
    this.currentSessionId = null;
    this.currentSession = null;

    // Session images state
    this.sessionImages = [];
    this.selectedImages = new Set();

    // Local upload state
    this.localFiles = [];
    this.selectedLocalFiles = new Set();
    this.localDirectoryHandle = null;
    this.localFilterText = '';

    // Processing state
    this.isProcessing = false;
    this.processingAborted = false;
    this.currentStage = null;
    this.stages = ['download', 'extract', 'store', 'complete'];

    // Filter state
    this.filterText = '';

    // Error tracking for summary display
    this.processingErrors = [];

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
    await this.loadModels();
    await this.loadSessions();

    this.initialized = true;
    console.log('ProcessingManager initialized with session-based workflow');
  }

  /**
   * Cache DOM element references
   */
  cacheElements() {
    this.elements = {
      // Step 1: Session selection
      sessionSelect: document.getElementById('session-select'),
      newSessionBtn: document.getElementById('new-session-btn'),
      newSessionName: document.getElementById('new-session-name'),
      newSessionDesc: document.getElementById('new-session-desc'),
      createSessionBtn: document.getElementById('create-session-btn'),
      deleteSessionBtn: document.getElementById('delete-session-btn'),
      sessionInfo: document.getElementById('session-info'),
      sessionImageCount: document.getElementById('session-image-count'),
      sessionDescription: document.getElementById('session-description'),

      // Step 2: Upload to session
      uploadSection: document.getElementById('upload-section'),
      browseBtn: document.getElementById('browse-btn'),
      localFolderPath: document.getElementById('local-folder-path'),
      localFileCount: document.getElementById('local-file-count'),
      localFileList: document.getElementById('local-file-list'),
      localFileFilter: document.getElementById('local-file-filter'),
      selectAllLocalBtn: document.getElementById('select-all-local-btn'),
      selectFilteredLocalBtn: document.getElementById('select-filtered-local-btn'),
      deselectAllLocalBtn: document.getElementById('deselect-all-local-btn'),
      selectedLocalCount: document.getElementById('selected-local-count'),
      localFilterStats: document.getElementById('local-filter-stats'),
      localFilteredCount: document.getElementById('local-filtered-count'),
      localTotalCount: document.getElementById('local-total-count'),
      uploadToSessionBtn: document.getElementById('upload-to-session-btn'),
      uploadProgress: document.getElementById('upload-progress'),
      uploadProgressFill: document.getElementById('upload-progress-fill'),
      uploadProgressText: document.getElementById('upload-progress-text'),

      // Step 3: Select images for processing
      sessionImagesSection: document.getElementById('session-images-section'),
      refreshSessionBtn: document.getElementById('refresh-session-btn'),
      imageFilter: document.getElementById('image-filter'),
      sessionImageList: document.getElementById('session-image-list'),
      selectAllImagesBtn: document.getElementById('select-all-images-btn'),
      deselectAllImagesBtn: document.getElementById('deselect-all-images-btn'),
      selectedImageCount: document.getElementById('selected-image-count'),
      totalSessionImages: document.getElementById('total-session-images'),

      // Step 4: Process
      processSection: document.getElementById('process-section'),
      modelSelect: document.getElementById('model-select'),
      batchSizeSelect: document.getElementById('batch-size-select'),
      processSelectedBtn: document.getElementById('process-selected-btn'),
      processAllBtn: document.getElementById('process-all-btn'),

      // Consensus mode
      consensusToggle: document.getElementById('consensus-toggle'),
      consensusOptions: document.getElementById('consensus-options'),
      consensusModelList: document.getElementById('consensus-model-list'),
      consensusAgreement: document.getElementById('consensus-agreement'),

      // Progress section
      progressSection: document.getElementById('progress-section'),
      stageDownload: document.getElementById('stage-download'),
      stageExtract: document.getElementById('stage-extract'),
      stageStore: document.getElementById('stage-store'),
      stageComplete: document.getElementById('stage-complete'),
      stageDetailsTitle: document.getElementById('stage-details-title'),
      stageDetailsProgress: document.getElementById('stage-details-progress'),
      progressFill: document.getElementById('progress-fill'),
      progressPercent: document.getElementById('progress-percent'),
      progressProcessed: document.getElementById('progress-processed'),
      progressSucceeded: document.getElementById('progress-succeeded'),
      progressFailed: document.getElementById('progress-failed'),
      progressLog: document.getElementById('progress-log'),
      toggleLogBtn: document.getElementById('toggle-log-btn'),
      cancelProcessingBtn: document.getElementById('cancel-processing-btn'),
      newRunBtn: document.getElementById('new-run-btn'),

      // Reprocess / Repair
      reprocessSessionBtn: document.getElementById('reprocess-session-btn'),
      repairDatesBtn: document.getElementById('repair-dates-btn'),

      // Database management (Database Tab)
      dbEntities: document.getElementById('db-entities'),
      dbRelationships: document.getElementById('db-relationships'),
      dbEmbeddings: document.getElementById('db-embeddings'),
      dbLiveImages: document.getElementById('db-live-images'),
      refreshDbStatsBtn: document.getElementById('refresh-db-stats-btn'),
      createBackupBtn: document.getElementById('create-backup-btn'),
      backupStatus: document.getElementById('backup-status'),
      dbActivityLog: document.getElementById('db-activity-log'),

      // Reset (Database Tab)
      resetAndProcessBtn: document.getElementById('reset-and-process-btn'),

      // Migration (Database Tab)
      migrationOldCount: document.getElementById('migration-old-count'),
      migrationLiveCount: document.getElementById('migration-live-count'),
      migrationSessionCount: document.getElementById('migration-session-count'),
      checkMigrationBtn: document.getElementById('check-migration-btn'),
      previewMigrationBtn: document.getElementById('preview-migration-btn'),
      runMigrationBtn: document.getElementById('run-migration-btn'),
      migrationPreview: document.getElementById('migration-preview'),
      previewToLive: document.getElementById('preview-to-live'),
      previewToLegacy: document.getElementById('preview-to-legacy'),
      previewAlreadyLive: document.getElementById('preview-already-live'),
      migrationResult: document.getElementById('migration-result'),
      resultToLive: document.getElementById('result-to-live'),
      resultToLegacy: document.getElementById('result-to-legacy'),
      resultErrors: document.getElementById('result-errors')
    };
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Step 1: Session management
    this.elements.sessionSelect?.addEventListener('change', (e) => this.selectSession(e.target.value));
    this.elements.newSessionBtn?.addEventListener('click', () => this.showNewSessionForm());
    this.elements.createSessionBtn?.addEventListener('click', () => this.createSession());
    this.elements.deleteSessionBtn?.addEventListener('click', () => this.deleteSession());
    this.elements.reprocessSessionBtn?.addEventListener('click', () => this.reprocessSession());
    this.elements.repairDatesBtn?.addEventListener('click', () => this.repairSessionDates());

    // Step 2: Upload
    this.elements.browseBtn?.addEventListener('click', () => this.browseLocalFolder());
    this.elements.localFileFilter?.addEventListener('input', (e) => {
      this.localFilterText = e.target.value.toLowerCase().trim();
      this.renderLocalFileList();
      this.updateLocalFilterStats();
    });
    this.elements.selectAllLocalBtn?.addEventListener('click', () => this.selectAllLocal());
    this.elements.selectFilteredLocalBtn?.addEventListener('click', () => this.selectFilteredLocal());
    this.elements.deselectAllLocalBtn?.addEventListener('click', () => this.deselectAllLocal());
    this.elements.localFileList?.addEventListener('click', (e) => this.handleLocalFileClick(e));
    this.elements.uploadToSessionBtn?.addEventListener('click', () => this.uploadToSession());

    // Step 3: Select images
    this.elements.refreshSessionBtn?.addEventListener('click', () => this.loadSessionImages());
    this.elements.imageFilter?.addEventListener('input', (e) => {
      this.filterText = e.target.value.toLowerCase().trim();
      this.renderSessionImages();
    });
    this.elements.selectAllImagesBtn?.addEventListener('click', () => this.selectAllImages());
    this.elements.deselectAllImagesBtn?.addEventListener('click', () => this.deselectAllImages());
    this.elements.sessionImageList?.addEventListener('click', (e) => this.handleImageClick(e));

    // Step 4: Process
    this.elements.processSelectedBtn?.addEventListener('click', () => this.processSelected());
    this.elements.processAllBtn?.addEventListener('click', () => this.processAll());

    // Consensus mode toggle
    this.elements.consensusToggle?.addEventListener('change', () => this.toggleConsensusMode());

    // Progress controls
    this.elements.toggleLogBtn?.addEventListener('click', () => this.toggleActivityLog());
    this.elements.cancelProcessingBtn?.addEventListener('click', () => this.cancelProcessing());
    this.elements.newRunBtn?.addEventListener('click', () => this.startNewRun());

    // Database management
    this.elements.refreshDbStatsBtn?.addEventListener('click', () => this.loadDatabaseStats());
    this.elements.createBackupBtn?.addEventListener('click', () => this.createBackup());
    this.elements.resetAndProcessBtn?.addEventListener('click', () => this.resetAndProcess());

    // Migration
    this.elements.checkMigrationBtn?.addEventListener('click', () => this.checkMigrationStatus());
    this.elements.previewMigrationBtn?.addEventListener('click', () => this.previewMigration());
    this.elements.runMigrationBtn?.addEventListener('click', () => this.runMigration());

    // NOTE: Database stats and migration status are loaded when the Database tab is opened
    // (handled by app.js switchTab function)
  }

  /**
   * Load available vision models
   */
  async loadModels() {
    try {
      const response = await fetch('/api/v1/posters/models', {
        headers: { 'X-API-Key': 'posters-api-key-2024' }
      });
      const result = await response.json();

      if (result.data?.models && this.elements.modelSelect) {
        const models = result.data.models;
        this.elements.modelSelect.innerHTML = models.map(m =>
          `<option value="${m.key}" ${m.key === result.data.current ? 'selected' : ''}>${m.description || m.key}</option>`
        ).join('');

        // Populate consensus model checklist
        if (this.elements.consensusModelList) {
          const defaultConsensusModels = ['minicpm-v-ollama', 'llava-13b-ollama'];
          this.elements.consensusModelList.innerHTML = models.map(m => {
            const checked = defaultConsensusModels.includes(m.key) ? 'checked' : '';
            const provider = m.key.split('-').pop() || '';
            return `<label class="consensus-model-item">
              <input type="checkbox" value="${m.key}" ${checked}>
              <span class="model-name">${m.description || m.key}</span>
              <span class="model-provider">${provider}</span>
            </label>`;
          }).join('');
        }
      }
    } catch (error) {
      console.error('Failed to load models:', error);
      if (this.elements.modelSelect) {
        this.elements.modelSelect.innerHTML = '<option value="">Default Model</option>';
      }
    }
  }

  /**
   * Toggle consensus mode options panel
   */
  toggleConsensusMode() {
    const enabled = this.elements.consensusToggle?.checked;
    if (this.elements.consensusOptions) {
      this.elements.consensusOptions.classList.toggle('hidden', !enabled);
    }
    if (this.elements.modelSelect) {
      this.elements.modelSelect.disabled = enabled;
    }
  }

  /**
   * Get selected consensus models from checkboxes
   */
  getConsensusOptions() {
    if (!this.elements.consensusToggle?.checked) return null;

    const checkboxes = this.elements.consensusModelList?.querySelectorAll('input[type="checkbox"]:checked') || [];
    const models = Array.from(checkboxes).map(cb => cb.value);

    if (models.length < 2) return null;

    return {
      enabled: true,
      models,
      minAgreementRatio: parseFloat(this.elements.consensusAgreement?.value || '0.5'),
      parallel: true
    };
  }

  // ==========================================================================
  // STEP 1: SESSION MANAGEMENT
  // ==========================================================================

  /**
   * Load all sessions
   */
  async loadSessions() {
    try {
      const response = await fetch('/api/v1/sessions', {
        headers: { 'X-API-Key': 'posters-api-key-2024' }
      });
      const result = await response.json();

      this.sessions = result.sessions || [];
      this.renderSessionSelect();

      if (this.sessions.length > 0 && !this.currentSessionId) {
        // Auto-select the first session
        await this.selectSession(this.sessions[0].sessionId);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
      this.showError('Failed to load sessions: ' + error.message);
    }
  }

  /**
   * Render session dropdown
   */
  renderSessionSelect() {
    if (!this.elements.sessionSelect) return;

    if (this.sessions.length === 0) {
      this.elements.sessionSelect.innerHTML = '<option value="">No sessions - create one</option>';
    } else {
      this.elements.sessionSelect.innerHTML = this.sessions.map(s =>
        `<option value="${s.sessionId}" ${s.sessionId === this.currentSessionId ? 'selected' : ''}>
          ${this.escapeHtml(s.name)} (${s.imageCount} images)
        </option>`
      ).join('');
    }
  }

  /**
   * Select a session
   */
  async selectSession(sessionId) {
    if (!sessionId) {
      this.currentSessionId = null;
      this.currentSession = null;
      this.sessionImages = [];
      this.selectedImages.clear();
      this.updateUI();
      return;
    }

    this.currentSessionId = sessionId;

    // Update dropdown to reflect new selection
    if (this.elements.sessionSelect) {
      this.elements.sessionSelect.value = sessionId;
    }

    try {
      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { 'X-API-Key': 'posters-api-key-2024' }
      });
      const result = await response.json();

      this.currentSession = result.session;
      await this.loadSessionImages();
      this.updateUI();
      this.updateSessionDescription();
      this.addLogEntry(`Selected session: ${this.currentSession.name}`, 'info');
    } catch (error) {
      console.error('Failed to load session:', error);
      this.showError('Failed to load session: ' + error.message);
    }
  }

  /**
   * Show new session form
   */
  showNewSessionForm() {
    if (this.elements.newSessionName) {
      this.elements.newSessionName.classList.remove('hidden');
      this.elements.newSessionName.focus();
    }
    if (this.elements.newSessionDesc) {
      this.elements.newSessionDesc.classList.remove('hidden');
    }
    if (this.elements.createSessionBtn) {
      this.elements.createSessionBtn.classList.remove('hidden');
    }
    if (this.elements.newSessionBtn) {
      this.elements.newSessionBtn.classList.add('hidden');
    }
  }

  /**
   * Create a new session
   */
  async createSession() {
    const name = this.elements.newSessionName?.value?.trim();
    if (!name) {
      this.showError('Please enter a session name');
      return;
    }

    const description = this.elements.newSessionDesc?.value?.trim() || undefined;

    try {
      const response = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'posters-api-key-2024'
        },
        body: JSON.stringify({ name, ...(description && { description }) })
      });
      const result = await response.json();

      if (!response.ok) {
        // Extract error message from various response formats
        const errorMsg = result.error?.message || result.error || result.message || 'Failed to create session';
        throw new Error(errorMsg);
      }

      if (result.success && result.session) {
        this.addLogEntry(`Created session: ${result.session.name}`, 'success');
        await this.loadSessions();
        await this.selectSession(result.session.sessionId);

        // Hide form
        if (this.elements.newSessionName) {
          this.elements.newSessionName.value = '';
          this.elements.newSessionName.classList.add('hidden');
        }
        if (this.elements.newSessionDesc) {
          this.elements.newSessionDesc.value = '';
          this.elements.newSessionDesc.classList.add('hidden');
        }
        if (this.elements.createSessionBtn) {
          this.elements.createSessionBtn.classList.add('hidden');
        }
        if (this.elements.newSessionBtn) {
          this.elements.newSessionBtn.classList.remove('hidden');
        }
      } else {
        throw new Error(result.error?.message || result.error || 'Failed to create session');
      }
    } catch (error) {
      console.error('Failed to create session:', error);
      this.showError('Failed to create session: ' + error.message);
    }
  }

  /**
   * Delete current session
   */
  async deleteSession() {
    if (!this.currentSessionId) return;

    if (this.sessionImages.length > 0) {
      this.showError('Cannot delete session with images. Remove all images first.');
      return;
    }

    const confirmed = confirm(`Delete session "${this.currentSession?.name}"?`);
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(this.currentSessionId)}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': 'posters-api-key-2024' }
      });
      const result = await response.json();

      if (result.success) {
        this.addLogEntry(`Deleted session: ${this.currentSession.name}`, 'success');
        this.currentSessionId = null;
        this.currentSession = null;
        await this.loadSessions();
      } else {
        throw new Error(result.error || 'Failed to delete session');
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      this.showError('Failed to delete session: ' + error.message);
    }
  }

  /**
   * Reprocess images from a completed session.
   * Cleans up graph entities and clones images into a new session.
   */
  async reprocessSession() {
    if (!this.currentSessionId) return;

    const sessionName = this.currentSession?.name || this.currentSessionId;
    const confirmed = confirm(
      `Reprocess session "${sessionName}"?\n\n` +
      `This will:\n` +
      `- Remove poster entities and their events from the graph\n` +
      `- Delete orphaned artists/venues (with no other connections)\n` +
      `- Copy images from live back into a new session\n` +
      `- Remove the live copies\n\n` +
      `You can then re-process the images with different settings.`
    );
    if (!confirmed) return;

    try {
      this.addLogEntry(`Reprocessing session: ${sessionName}...`, 'info');
      this.elements.reprocessSessionBtn.disabled = true;

      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(this.currentSessionId)}/reprocess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'posters-api-key-2024'
        }
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error?.message || result.message || 'Reprocess failed');
      }

      if (result.success) {
        const cleanup = result.graphCleanup || [];
        const totalDeleted = cleanup.reduce((sum, c) => sum + (c.deleted?.length || 0), 0);

        this.addLogEntry(
          `Reprocess complete: ${result.imagesCloned} images cloned to new session. ` +
          `${totalDeleted} graph entities cleaned up.`,
          'success'
        );

        // Mark browse as stale since we deleted graph entities
        window.posterApp?.markBrowseStale();

        // Reload sessions and select the new one
        await this.loadSessions();
        if (result.newSession?.sessionId) {
          await this.selectSession(result.newSession.sessionId);
        }
      } else {
        throw new Error('Reprocess failed');
      }
    } catch (error) {
      console.error('Failed to reprocess session:', error);
      this.showError('Failed to reprocess session: ' + error.message);
    } finally {
      if (this.elements.reprocessSessionBtn) {
        this.elements.reprocessSessionBtn.disabled = false;
      }
    }
  }

  /**
   * Repair dates on existing posters from a completed session.
   * Re-parses raw date strings using improved logic without re-running vision models.
   */
  async repairSessionDates() {
    if (!this.currentSessionId) return;

    const sessionName = this.currentSession?.name || this.currentSessionId;
    const confirmed = confirm(
      `Repair dates for session "${sessionName}"?\n\n` +
      `This will:\n` +
      `- Scan all posters from this session for unparsed dates\n` +
      `- Re-parse date strings using improved parsing logic\n` +
      `- Create missing Show entities and link them\n` +
      `- Update poster observations with corrected dates\n\n` +
      `No vision model calls needed — uses already-extracted data.`
    );
    if (!confirmed) return;

    try {
      this.addLogEntry(`Repairing dates for session: ${sessionName}...`, 'info');
      this.elements.repairDatesBtn.disabled = true;

      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(this.currentSessionId)}/repair-dates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'posters-api-key-2024'
        }
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error?.message || result.message || 'Date repair failed');
      }

      if (result.success) {
        this.addLogEntry(
          `Date repair complete: ${result.postersScanned} posters scanned, ` +
          `${result.postersRepaired} repaired, ${result.showsCreated} shows created.`,
          'success'
        );

        // Log individual results
        for (const detail of (result.details || [])) {
          if (detail.status === 'repaired') {
            this.addLogEntry(
              `  ${detail.entityName}: "${detail.rawDate}" → ${detail.parsedDates?.join(', ')} (${detail.showsCreated} show(s))`,
              'success'
            );
          } else if (detail.status === 'error') {
            this.addLogEntry(`  ${detail.entityName}: Error - ${detail.message}`, 'error');
          }
        }

        // Mark browse as stale since we created new entities
        window.posterApp?.markBrowseStale();
      } else {
        throw new Error('Date repair failed');
      }
    } catch (error) {
      console.error('Failed to repair dates:', error);
      this.showError('Failed to repair dates: ' + error.message);
    } finally {
      if (this.elements.repairDatesBtn) {
        this.elements.repairDatesBtn.disabled = false;
      }
    }
  }

  // ==========================================================================
  // STEP 2: UPLOAD TO SESSION
  // ==========================================================================

  /**
   * Browse for local folder
   */
  async browseLocalFolder() {
    if (!('showDirectoryPicker' in window)) {
      this.showError('Your browser does not support folder selection. Use Chrome or Edge.');
      return;
    }

    try {
      const handle = await window.showDirectoryPicker();
      this.localDirectoryHandle = handle;

      if (this.elements.localFolderPath) {
        this.elements.localFolderPath.textContent = handle.name;
      }

      await this.scanLocalFolder();
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Failed to browse folder:', error);
        this.showError('Failed to access folder: ' + error.message);
      }
    }
  }

  /**
   * Scan local folder for images
   */
  async scanLocalFolder() {
    if (!this.localDirectoryHandle) return;

    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];
    const files = [];

    for await (const entry of this.localDirectoryHandle.values()) {
      if (entry.kind === 'file') {
        const name = entry.name.toLowerCase();
        if (imageExtensions.some(ext => name.endsWith(ext))) {
          const file = await entry.getFile();
          files.push({
            name: entry.name,
            size: file.size,
            handle: entry,
            file: file
          });
        }
      }
    }

    this.localFiles = files;
    this.selectedLocalFiles.clear();
    this.localFilterText = '';
    if (this.elements.localFileFilter) this.elements.localFileFilter.value = '';

    if (this.elements.localFileCount) {
      this.elements.localFileCount.textContent = files.length;
    }

    this.renderLocalFileList();
    this.updateLocalSelection();
    this.updateLocalFilterStats();
    this.addLogEntry(`Found ${files.length} images in local folder`, 'info');
  }

  /**
   * Render local file list
   */
  renderLocalFileList() {
    if (!this.elements.localFileList) return;

    if (this.localFiles.length === 0) {
      this.elements.localFileList.innerHTML = `
        <div class="file-list-empty">
          <p>No local folder selected</p>
          <p>Click "Browse Local Folder" to select images</p>
        </div>`;
      return;
    }

    let files = this.localFiles;
    if (this.localFilterText) {
      files = files.filter(f => f.name.toLowerCase().includes(this.localFilterText));
    }

    if (files.length === 0) {
      this.elements.localFileList.innerHTML = `
        <div class="file-list-empty">
          <p>No files match filter</p>
        </div>`;
      return;
    }

    this.elements.localFileList.innerHTML = files.map(file => `
      <div class="file-item ${this.selectedLocalFiles.has(file.name) ? 'selected' : ''}" data-name="${this.escapeHtml(file.name)}">
        <input type="checkbox" ${this.selectedLocalFiles.has(file.name) ? 'checked' : ''}>
        <div class="file-info">
          <div class="filename">${this.escapeHtml(file.name)}</div>
          <div class="file-meta">${this.formatFileSize(file.size)}</div>
        </div>
      </div>
    `).join('');
  }

  /**
   * Handle click on local file list
   */
  handleLocalFileClick(e) {
    const fileItem = e.target.closest('.file-item');
    if (!fileItem) return;

    const name = fileItem.dataset.name;
    if (this.selectedLocalFiles.has(name)) {
      this.selectedLocalFiles.delete(name);
      fileItem.classList.remove('selected');
      fileItem.querySelector('input').checked = false;
    } else {
      this.selectedLocalFiles.add(name);
      fileItem.classList.add('selected');
      fileItem.querySelector('input').checked = true;
    }
    this.updateLocalSelection();
  }

  selectAllLocal() {
    this.localFiles.forEach(f => this.selectedLocalFiles.add(f.name));
    this.renderLocalFileList();
    this.updateLocalSelection();
  }

  deselectAllLocal() {
    this.selectedLocalFiles.clear();
    this.renderLocalFileList();
    this.updateLocalSelection();
  }

  selectFilteredLocal() {
    let files = this.localFiles;
    if (this.localFilterText) {
      files = files.filter(f => f.name.toLowerCase().includes(this.localFilterText));
    }
    files.forEach(f => this.selectedLocalFiles.add(f.name));
    this.renderLocalFileList();
    this.updateLocalSelection();
  }

  updateLocalFilterStats() {
    if (!this.elements.localFilterStats) return;
    if (this.localFilterText && this.localFiles.length > 0) {
      const filtered = this.localFiles.filter(f => f.name.toLowerCase().includes(this.localFilterText));
      this.elements.localFilterStats.classList.remove('hidden');
      if (this.elements.localFilteredCount) this.elements.localFilteredCount.textContent = filtered.length;
      if (this.elements.localTotalCount) this.elements.localTotalCount.textContent = this.localFiles.length;
    } else {
      this.elements.localFilterStats.classList.add('hidden');
    }
  }

  updateLocalSelection() {
    const count = this.selectedLocalFiles.size;
    if (this.elements.selectedLocalCount) {
      this.elements.selectedLocalCount.textContent = count;
    }
    if (this.elements.uploadToSessionBtn) {
      this.elements.uploadToSessionBtn.disabled = count === 0 || !this.currentSessionId;
    }
  }

  /**
   * Upload selected files to current session
   */
  async uploadToSession() {
    if (!this.currentSessionId) {
      this.showError('Please select or create a session first');
      return;
    }

    const selectedFiles = this.localFiles.filter(f => this.selectedLocalFiles.has(f.name));
    if (selectedFiles.length === 0) return;

    if (this.elements.uploadToSessionBtn) this.elements.uploadToSessionBtn.disabled = true;
    if (this.elements.uploadProgress) this.elements.uploadProgress.classList.remove('hidden');

    let uploaded = 0;
    const total = selectedFiles.length;

    try {
      for (const localFile of selectedFiles) {
        const file = localFile.file || await localFile.handle.getFile();
        const formData = new FormData();
        formData.append('images', file, localFile.name);

        const response = await fetch(`/api/v1/sessions/${encodeURIComponent(this.currentSessionId)}/images`, {
          method: 'POST',
          headers: { 'X-API-Key': 'posters-api-key-2024' },
          body: formData
        });

        if (!response.ok) {
          const result = await response.json();
          const errorMsg = result.error?.message || result.error || result.message || `Failed to upload ${localFile.name}`;
          throw new Error(errorMsg);
        }

        uploaded++;
        this.updateUploadProgress(Math.round((uploaded / total) * 100), `Uploading ${uploaded} of ${total}...`);
      }

      this.addLogEntry(`Uploaded ${uploaded} images to session`, 'success');

      // Refresh session images
      await this.loadSessionImages();

      // Clear local selection
      this.selectedLocalFiles.clear();
      this.renderLocalFileList();
      this.updateLocalSelection();

    } catch (error) {
      console.error('Upload failed:', error);
      this.addLogEntry('Upload failed: ' + error.message, 'error');
      this.showError('Upload failed: ' + error.message);
    } finally {
      if (this.elements.uploadProgress) this.elements.uploadProgress.classList.add('hidden');
      if (this.elements.uploadToSessionBtn) this.elements.uploadToSessionBtn.disabled = false;
    }
  }

  updateUploadProgress(percent, text) {
    if (this.elements.uploadProgressFill) {
      this.elements.uploadProgressFill.style.width = `${percent}%`;
    }
    if (this.elements.uploadProgressText) {
      this.elements.uploadProgressText.textContent = text;
    }
  }

  // ==========================================================================
  // STEP 3: SELECT IMAGES FOR PROCESSING
  // ==========================================================================

  /**
   * Load images from current session
   */
  async loadSessionImages() {
    if (!this.currentSessionId) {
      this.sessionImages = [];
      this.selectedImages.clear();
      this.renderSessionImages();
      return;
    }

    try {
      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(this.currentSessionId)}/images`, {
        headers: { 'X-API-Key': 'posters-api-key-2024' }
      });
      const result = await response.json();

      this.sessionImages = result.images || [];
      this.selectedImages.clear();

      if (this.elements.totalSessionImages) {
        this.elements.totalSessionImages.textContent = this.sessionImages.length;
      }

      this.renderSessionImages();
      this.updateImageSelection();

    } catch (error) {
      console.error('Failed to load session images:', error);
      this.showError('Failed to load session images: ' + error.message);
    }
  }

  /**
   * Render session images as thumbnail grid
   */
  renderSessionImages() {
    if (!this.elements.sessionImageList) return;

    let images = this.sessionImages;

    // Apply filter
    if (this.filterText) {
      images = images.filter(img => img.filename.toLowerCase().includes(this.filterText));
    }

    if (images.length === 0) {
      this.elements.sessionImageList.innerHTML = `
        <div class="file-list-empty">
          <p>${this.sessionImages.length === 0 ? 'No images in session' : 'No images match filter'}</p>
          <p>Upload images using the section above</p>
        </div>`;
      return;
    }

    this.elements.sessionImageList.innerHTML = images.map(img => `
      <div class="image-card ${this.selectedImages.has(img.hash) ? 'selected' : ''}" data-hash="${img.hash}">
        <div class="image-checkbox">
          <input type="checkbox" ${this.selectedImages.has(img.hash) ? 'checked' : ''}>
        </div>
        <div class="image-thumbnail">
          <img src="${img.url}" alt="${this.escapeHtml(img.filename)}" loading="lazy">
          <button type="button" class="image-zoom-btn" data-url="${this.escapeHtml(img.url)}" data-name="${this.escapeHtml(img.filename)}" title="Enlarge image">&#x1F50D;</button>
        </div>
        <div class="image-info">
          <div class="image-name" title="${this.escapeHtml(img.filename)}">${this.escapeHtml(img.filename)}</div>
          <div class="image-size">${this.formatFileSize(img.sizeBytes)}</div>
        </div>
      </div>
    `).join('');
  }

  /**
   * Handle click on session image
   */
  handleImageClick(e) {
    // Check for zoom button click - open lightbox instead of toggling selection
    const zoomBtn = e.target.closest('.image-zoom-btn');
    if (zoomBtn) {
      e.stopPropagation();
      this.openImageLightbox(zoomBtn.dataset.url, zoomBtn.dataset.name);
      return;
    }

    const card = e.target.closest('.image-card');
    if (!card) return;

    const hash = card.dataset.hash;
    if (this.selectedImages.has(hash)) {
      this.selectedImages.delete(hash);
      card.classList.remove('selected');
      card.querySelector('input').checked = false;
    } else {
      this.selectedImages.add(hash);
      card.classList.add('selected');
      card.querySelector('input').checked = true;
    }
    this.updateImageSelection();
  }

  /**
   * Open the lightbox modal with an image (reuses browse tab lightbox)
   */
  openImageLightbox(url, name) {
    const lightbox = document.getElementById('lightbox-modal');
    const lightboxImage = document.getElementById('lightbox-image');
    const lightboxCaption = document.getElementById('lightbox-caption');
    if (lightbox && lightboxImage) {
      lightboxImage.src = url;
      if (lightboxCaption) lightboxCaption.textContent = name || '';
      lightbox.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  }

  selectAllImages() {
    this.sessionImages.forEach(img => this.selectedImages.add(img.hash));
    this.renderSessionImages();
    this.updateImageSelection();
  }

  deselectAllImages() {
    this.selectedImages.clear();
    this.renderSessionImages();
    this.updateImageSelection();
  }

  updateImageSelection() {
    const count = this.selectedImages.size;
    if (this.elements.selectedImageCount) {
      this.elements.selectedImageCount.textContent = count;
    }
    if (this.elements.processSelectedBtn) {
      this.elements.processSelectedBtn.disabled = count === 0 || this.isProcessing;
    }
    if (this.elements.processAllBtn) {
      this.elements.processAllBtn.disabled = this.sessionImages.length === 0 || this.isProcessing;
    }
  }

  // ==========================================================================
  // STEP 4: PROCESSING
  // ==========================================================================

  /**
   * Process selected images
   */
  async processSelected() {
    const hashes = Array.from(this.selectedImages);
    if (hashes.length === 0) return;
    await this.runProcessing(hashes);
  }

  /**
   * Process all images in session
   */
  async processAll() {
    const hashes = this.sessionImages.map(img => img.hash);
    if (hashes.length === 0) return;
    await this.runProcessing(hashes);
  }

  /**
   * Run processing pipeline - processes images one at a time for real-time progress
   */
  async runProcessing(hashes) {
    if (!this.currentSessionId) {
      this.showError('No session selected');
      return;
    }

    this.isProcessing = true;
    this.processingAborted = false;

    // Show progress section
    if (this.elements.progressSection) {
      this.elements.progressSection.classList.remove('hidden');
    }
    this.resetProgress();
    this.resetPipelineStages();

    // Disable buttons
    this.updateImageSelection();

    const modelKey = this.elements.modelSelect?.value || undefined;
    const consensus = this.getConsensusOptions();
    const total = hashes.length;
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    this.addLogEntry(`Processing ${total} images from session...`, 'info');
    if (consensus) {
      this.addLogEntry(`Consensus mode: ${consensus.models.length} models (${consensus.models.join(', ')})`, 'info');
    }

    try {
      for (let i = 0; i < hashes.length; i++) {
        if (this.processingAborted) {
          this.addLogEntry('Processing cancelled by user', 'info');
          break;
        }

        const hash = hashes[i];
        const imageInfo = this.sessionImages.find(img => img.hash === hash);
        const imageName = imageInfo?.filename || hash.substring(0, 8);

        // Stage 1: Download
        this.setStage('download', 'active');
        this.updateStageDetails('download', `${i + 1} of ${total}`);
        this.addLogEntry(`📥 Downloading: ${imageName}`, 'info');

        // Small delay to show download stage
        await this.sleep(100);

        // Stage 2: Extract
        this.setStage('extract', 'active');
        this.updateStageDetails('extract', `${i + 1} of ${total}`);
        this.addLogEntry(`🔍 Extracting: ${imageName}`, 'info');

        try {
          const response = await fetch(`/api/v1/sessions/${encodeURIComponent(this.currentSessionId)}/process`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': 'posters-api-key-2024'
            },
            body: JSON.stringify({
              imageHashes: [hash],
              batchSize: 1,
              modelKey,
              ...(consensus && { consensus })
            })
          });

          const result = await response.json();

          if (result.success && result.results?.length > 0) {
            const r = result.results[0];

            // Stage 3: Store
            this.setStage('store', 'active');
            this.updateStageDetails('store', `${i + 1} of ${total}`);

            if (r.success) {
              succeeded++;
              // Stage 4: Complete (for this image)
              this.addLogEntry(`✓ ${r.title || r.entityName || imageName} → moved to live`, 'success');
            } else {
              failed++;
              this.processingErrors.push({ imageName, hash, error: r.error || 'Unknown error' });
              this.addLogEntry(`✗ ${imageName}: ${r.error}`, 'error');
            }
          } else {
            failed++;
            const errorMsg = result.error || 'Processing failed';
            this.processingErrors.push({ imageName, hash, error: errorMsg });
            this.addLogEntry(`✗ ${imageName}: ${errorMsg}`, 'error');
          }

        } catch (error) {
          failed++;
          this.processingErrors.push({ imageName, hash, error: error.message });
          this.addLogEntry(`✗ ${imageName}: ${error.message}`, 'error');
        }

        processed++;

        // Update overall progress
        const percent = Math.round((processed / total) * 100);
        this.updateProgress(percent, processed, succeeded, failed);
      }

      // Final stage update
      if (succeeded > 0) {
        this.setStage('complete', 'completed');
        this.updateStageDetails('complete', '');
      } else if (failed > 0) {
        this.setStage('store', 'error');
      }

      this.addLogEntry(`Processing complete: ${succeeded} succeeded, ${failed} failed`, succeeded > 0 ? 'success' : 'error');

      // Show error summary if any failures
      if (failed > 0) {
        this.showErrorSummary();
      }

      // Refresh session images (some moved to live)
      await this.loadSessionImages();
      await this.loadSessions(); // Update session counts
      await this.loadDatabaseStats(); // Update live count

      // Mark browse tab as stale so it refreshes when switched to
      if (succeeded > 0) {
        window.posterApp?.markBrowseStale();
      }

    } catch (error) {
      console.error('Processing error:', error);
      this.addLogEntry('Error: ' + error.message, 'error');
      this.setStage(this.currentStage || 'extract', 'error');
    } finally {
      this.isProcessing = false;
      this.updateImageSelection();

      // Show "New Run" button, hide "Cancel"
      if (this.elements.newRunBtn) this.elements.newRunBtn.classList.remove('hidden');
      if (this.elements.cancelProcessingBtn) this.elements.cancelProcessingBtn.classList.add('hidden');
    }
  }

  /**
   * Sleep helper for UI updates
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // PROGRESS & UI HELPERS
  // ==========================================================================

  updateUI() {
    // Show/hide sections based on state
    const hasSession = !!this.currentSessionId;

    if (this.elements.uploadSection) {
      this.elements.uploadSection.classList.toggle('hidden', !hasSession);
    }
    if (this.elements.sessionImagesSection) {
      this.elements.sessionImagesSection.classList.toggle('hidden', !hasSession);
    }
    if (this.elements.processSection) {
      this.elements.processSection.classList.toggle('hidden', !hasSession);
    }
    if (this.elements.deleteSessionBtn) {
      this.elements.deleteSessionBtn.disabled = !hasSession || this.sessionImages.length > 0;
    }
    if (this.elements.sessionImageCount) {
      this.elements.sessionImageCount.textContent = this.currentSession?.imageCount || 0;
    }

    // Show reprocess / repair buttons when session has 0 remaining images (all processed to live)
    const showPostProcessActions = hasSession && this.sessionImages.length === 0;
    if (this.elements.reprocessSessionBtn) {
      this.elements.reprocessSessionBtn.classList.toggle('hidden', !showPostProcessActions);
    }
    if (this.elements.repairDatesBtn) {
      this.elements.repairDatesBtn.classList.toggle('hidden', !showPostProcessActions);
    }
  }

  /**
   * Show/hide session description display
   */
  updateSessionDescription() {
    if (!this.elements.sessionDescription) return;

    if (this.currentSession?.description) {
      this.elements.sessionDescription.textContent = this.currentSession.description;
      this.elements.sessionDescription.classList.remove('hidden');
    } else {
      this.elements.sessionDescription.classList.add('hidden');
    }
  }

  setStage(stageName, status = 'active') {
    this.currentStage = stageName;
    const currentIndex = this.stages.indexOf(stageName);

    this.stages.forEach((stage, index) => {
      const stageEl = document.getElementById(`stage-${stage}`);
      if (!stageEl) return;

      stageEl.classList.remove('pending', 'active', 'completed', 'error');

      if (stage === stageName) {
        stageEl.classList.add(status);
      } else if (index < currentIndex) {
        stageEl.classList.add('completed');
      } else {
        stageEl.classList.add('pending');
      }
    });

    // Update connectors between stages
    this.updateConnectors(currentIndex, status);
  }

  /**
   * Update connector lines between pipeline stages
   */
  updateConnectors(currentIndex, currentStatus) {
    const connectors = document.querySelectorAll('.pipeline-connector');
    connectors.forEach((connector, index) => {
      connector.classList.remove('completed', 'active');

      if (index < currentIndex) {
        connector.classList.add('completed');
      } else if (index === currentIndex - 1 && currentStatus === 'active') {
        connector.classList.add('active');
      }
    });
  }

  updateStageDetails(stageName, progressText = '') {
    const titles = {
      download: 'Downloading image from S3...',
      extract: 'Extracting data with vision model...',
      store: 'Storing results in database...',
      complete: 'Processing complete!'
    };

    if (this.elements.stageDetailsTitle) {
      this.elements.stageDetailsTitle.textContent = titles[stageName] || 'Processing...';
    }
    if (this.elements.stageDetailsProgress) {
      this.elements.stageDetailsProgress.textContent = progressText ? `Image ${progressText}` : '';
    }
  }

  resetPipelineStages() {
    this.stages.forEach(stage => {
      const el = document.getElementById(`stage-${stage}`);
      if (el) {
        el.classList.remove('pending', 'active', 'completed', 'error');
        el.classList.add('pending');
      }
    });

    // Reset connectors
    const connectors = document.querySelectorAll('.pipeline-connector');
    connectors.forEach(connector => {
      connector.classList.remove('completed', 'active');
    });

    if (this.elements.stageDetailsTitle) {
      this.elements.stageDetailsTitle.textContent = 'Initializing...';
    }
    if (this.elements.stageDetailsProgress) {
      this.elements.stageDetailsProgress.textContent = '';
    }
  }

  updateProgress(percent, processed, succeeded, failed) {
    if (this.elements.progressFill) this.elements.progressFill.style.width = `${percent}%`;
    if (this.elements.progressPercent) this.elements.progressPercent.textContent = `${percent}%`;
    if (this.elements.progressProcessed) this.elements.progressProcessed.textContent = processed;
    if (this.elements.progressSucceeded) this.elements.progressSucceeded.textContent = succeeded;
    if (this.elements.progressFailed) this.elements.progressFailed.textContent = failed;
  }

  resetProgress() {
    this.updateProgress(0, 0, 0, 0);
    if (this.elements.progressLog) this.elements.progressLog.innerHTML = '';
    this.processingErrors = [];
    const errorSummary = document.getElementById('error-summary');
    if (errorSummary) errorSummary.classList.add('hidden');
  }

  addLogEntry(message, type = 'info') {
    if (!this.elements.progressLog) return;

    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `<span class="log-time">[${timestamp}]</span> ${this.escapeHtml(message)}`;

    this.elements.progressLog.appendChild(entry);
    this.elements.progressLog.scrollTop = this.elements.progressLog.scrollHeight;
  }

  toggleActivityLog() {
    const container = document.querySelector('.activity-log-container');
    if (container) {
      const collapsed = container.classList.toggle('collapsed');
      if (this.elements.toggleLogBtn) {
        this.elements.toggleLogBtn.textContent = collapsed ? 'Show' : 'Hide';
      }
    }
  }

  cancelProcessing() {
    this.processingAborted = true;
    this.addLogEntry('Cancelling...', 'info');
  }

  /**
   * Show error summary after processing with failures
   */
  showErrorSummary() {
    if (this.processingErrors.length === 0) return;

    const summaryEl = document.getElementById('error-summary');
    if (!summaryEl) return;

    summaryEl.classList.remove('hidden');
    summaryEl.innerHTML = `
      <div class="error-summary-header">
        <span class="error-summary-title">${this.processingErrors.length} image(s) failed</span>
        <button type="button" class="toggle-btn" id="toggle-error-details">Show Details</button>
      </div>
      <div class="error-summary-details hidden">
        ${this.processingErrors.map(e => `
          <div class="error-detail-row">
            <span class="error-image-name">${this.escapeHtml(e.imageName)}</span>
            <span class="error-message">${this.escapeHtml(e.error)}</span>
          </div>
        `).join('')}
      </div>
    `;

    document.getElementById('toggle-error-details')?.addEventListener('click', () => {
      const details = summaryEl.querySelector('.error-summary-details');
      const btn = document.getElementById('toggle-error-details');
      if (details) {
        const isHidden = details.classList.toggle('hidden');
        if (btn) btn.textContent = isHidden ? 'Show Details' : 'Hide Details';
      }
    });
  }

  /**
   * Reset processing UI for a new run
   */
  startNewRun() {
    // Hide progress section
    if (this.elements.progressSection) {
      this.elements.progressSection.classList.add('hidden');
    }

    // Hide error summary if present
    const errorSummary = document.getElementById('error-summary');
    if (errorSummary) errorSummary.classList.add('hidden');

    // Reset progress state
    this.resetProgress();
    this.resetPipelineStages();

    // Restore button visibility
    if (this.elements.newRunBtn) this.elements.newRunBtn.classList.add('hidden');
    if (this.elements.cancelProcessingBtn) this.elements.cancelProcessingBtn.classList.remove('hidden');

    // Clear selection and refresh
    this.selectedImages.clear();
    this.updateImageSelection();
    this.loadSessionImages();
  }

  showError(message) {
    alert(message);
  }

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

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ==========================================================================
  // DATABASE MANAGEMENT
  // ==========================================================================

  async loadDatabaseStats() {
    try {
      // Fetch database stats
      const response = await fetch('/api/v1/posters/database/stats', {
        headers: { 'X-API-Key': 'posters-api-key-2024' }
      });
      const result = await response.json();

      if (result.data) {
        if (this.elements.dbEntities) {
          this.elements.dbEntities.textContent = result.data.neo4j?.entities?.toLocaleString() || '0';
        }
        if (this.elements.dbRelationships) {
          this.elements.dbRelationships.textContent = result.data.neo4j?.relationships?.toLocaleString() || '0';
        }
        if (this.elements.dbEmbeddings) {
          this.elements.dbEmbeddings.textContent = result.data.postgres?.embeddings?.toLocaleString() || '0';
        }
      }

      // Fetch live folder stats
      const liveResponse = await fetch('/api/v1/live/stats', {
        headers: { 'X-API-Key': 'posters-api-key-2024' }
      });
      const liveResult = await liveResponse.json();

      if (this.elements.dbLiveImages) {
        this.elements.dbLiveImages.textContent = liveResult.totalImages?.toLocaleString() || '0';
      }

      // Enable reset button if there's data in the database
      const hasData = (result.data?.neo4j?.entities || 0) > 0;
      if (this.elements.resetAndProcessBtn) {
        this.elements.resetAndProcessBtn.disabled = !hasData;
      }

    } catch (error) {
      console.error('Failed to load database stats:', error);
      if (this.elements.dbEntities) this.elements.dbEntities.textContent = 'Error';
      if (this.elements.dbRelationships) this.elements.dbRelationships.textContent = 'Error';
      if (this.elements.dbEmbeddings) this.elements.dbEmbeddings.textContent = 'Error';
      if (this.elements.dbLiveImages) this.elements.dbLiveImages.textContent = 'Error';
    }
  }

  addDbLogEntry(message, type = 'info') {
    const log = this.elements.dbActivityLog;
    if (!log) return;

    const empty = log.querySelector('.db-log-empty');
    if (empty) empty.remove();

    const entry = document.createElement('div');
    entry.className = `db-log-entry ${type}`;

    const timestamp = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${this.escapeHtml(message)}`;

    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  async createBackup() {
    const btn = this.elements.createBackupBtn;
    const status = this.elements.backupStatus;

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-icon">⏳</span> Creating Backup...';
    }

    this.addDbLogEntry('Creating backup...', 'info');

    try {
      const response = await fetch('/api/v1/posters/database/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'posters-api-key-2024'
        },
        body: JSON.stringify({ compress: false })
      });
      const result = await response.json();

      if (result.data?.success) {
        this.addDbLogEntry(`✓ Backup created: ${result.data.timestamp}`, 'success');

        if (status) {
          status.classList.remove('hidden', 'error');
          status.innerHTML = `<span class="status-icon">✓</span> <span class="status-text">Backup created: ${result.data.timestamp}</span>`;
        }
      } else {
        throw new Error(result.error || result.data?.error || 'Backup failed');
      }
    } catch (error) {
      console.error('Backup failed:', error);
      this.addDbLogEntry(`✗ Backup failed: ${error.message}`, 'error');

      if (status) {
        status.classList.remove('hidden');
        status.classList.add('error');
        status.innerHTML = '<span class="status-icon">✗</span> <span class="status-text">Backup failed</span>';
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">💾</span> Create Backup';
      }
    }
  }

  // ============================================================================
  // Reset & Reprocess
  // ============================================================================

  async resetAndProcess() {
    const confirmed = confirm(
      'WARNING: This will:\n\n' +
      '1. Archive all live images to a timestamped S3 folder\n' +
      '2. Create a backup of all database data\n' +
      '3. DELETE all entities, relationships, and embeddings\n' +
      '4. Clear the live images folder\n' +
      '5. Reseed poster type definitions\n\n' +
      'This cannot be undone (except by restoring the backup).\n\n' +
      'Are you sure?'
    );
    if (!confirmed) return;

    const btn = this.elements.resetAndProcessBtn;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-icon">⏳</span> Resetting...';
    }

    this.addDbLogEntry('Starting backup and reset...', 'info');

    try {
      const response = await fetch('/api/v1/posters/database/backup-and-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'posters-api-key-2024'
        },
        body: JSON.stringify({ confirm: 'CONFIRM_RESET' })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error?.message || result.error || result.message || 'Reset failed');
      }

      if (result.data?.success) {
        const { archive, backup, reset, seeded } = result.data;

        if (archive && (archive.imagesCopied > 0 || archive.metadataCopied > 0)) {
          this.addDbLogEntry(
            `✓ Archived ${archive.imagesCopied} images and ${archive.metadataCopied} metadata files to ${archive.archivePath}`,
            'success'
          );
        } else {
          this.addDbLogEntry('No live images to archive', 'info');
        }
        this.addDbLogEntry(
          `✓ Backup created: ${backup.stats.entities} entities, ${backup.stats.relationships} relationships, ${backup.stats.embeddings} embeddings`,
          'success'
        );
        this.addDbLogEntry(
          `✓ Database reset: removed ${reset.entitiesRemoved} entities, ${reset.relationshipsRemoved} relationships, ${reset.embeddingsRemoved} embeddings`,
          'success'
        );
        this.addDbLogEntry(
          `✓ Reseeded ${seeded.posterTypesCreated} poster types`,
          'success'
        );

        // Refresh stats to reflect empty database
        await this.loadDatabaseStats();

        // Mark browse tab as stale
        window.posterApp?.markBrowseStale();
      } else {
        throw new Error(result.error || 'Reset failed');
      }
    } catch (error) {
      console.error('Reset failed:', error);
      this.addDbLogEntry('✗ Reset failed: ' + error.message, 'error');
      this.showError('Reset failed: ' + error.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">🔄</span> Reset Database';
      }
    }
  }

  // ============================================================================
  // Migration Methods
  // ============================================================================

  async checkMigrationStatus() {
    const btn = this.elements.checkMigrationBtn;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-icon">⏳</span> Checking...';
    }

    try {
      const response = await fetch('/api/v1/migration/status', {
        headers: { 'X-API-Key': 'posters-api-key-2024' }
      });
      const result = await response.json();

      if (result.status) {
        const { oldStructure, newStructure } = result.status;

        if (this.elements.migrationOldCount) {
          this.elements.migrationOldCount.textContent = oldStructure.originalsCount?.toLocaleString() || '0';
        }
        if (this.elements.migrationLiveCount) {
          this.elements.migrationLiveCount.textContent = newStructure.liveImagesCount?.toLocaleString() || '0';
        }
        if (this.elements.migrationSessionCount) {
          this.elements.migrationSessionCount.textContent = newStructure.sessionsCount?.toLocaleString() || '0';
        }

        // Enable/disable migration buttons based on status
        const needsMigration = oldStructure.originalsCount > 0;
        if (this.elements.previewMigrationBtn) {
          this.elements.previewMigrationBtn.disabled = !needsMigration;
        }
        if (this.elements.runMigrationBtn) {
          this.elements.runMigrationBtn.disabled = !needsMigration;
        }

        // Hide any previous results
        if (this.elements.migrationPreview) {
          this.elements.migrationPreview.classList.add('hidden');
        }
        if (this.elements.migrationResult) {
          this.elements.migrationResult.classList.add('hidden');
        }

        if (!needsMigration) {
          this.addDbLogEntry('No migration needed - old structure is empty', 'info');
        }
      }
    } catch (error) {
      console.error('Failed to check migration status:', error);
      this.addDbLogEntry(`Failed to check migration status: ${error.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">🔍</span> Check Status';
      }
    }
  }

  async previewMigration() {
    const btn = this.elements.previewMigrationBtn;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-icon">⏳</span> Analyzing...';
    }

    this.addDbLogEntry('Analyzing migration...', 'info');

    try {
      const response = await fetch('/api/v1/migration/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'posters-api-key-2024'
        }
      });
      const result = await response.json();

      if (this.elements.previewToLive) {
        this.elements.previewToLive.textContent = result.wouldMigrateToLive?.toLocaleString() || '0';
      }
      if (this.elements.previewToLegacy) {
        this.elements.previewToLegacy.textContent = result.wouldMoveToLegacy?.toLocaleString() || '0';
      }
      if (this.elements.previewAlreadyLive) {
        this.elements.previewAlreadyLive.textContent = result.alreadyInLive?.toLocaleString() || '0';
      }

      if (this.elements.migrationPreview) {
        this.elements.migrationPreview.classList.remove('hidden');
      }

      this.addDbLogEntry(
        `Preview: ${result.wouldMigrateToLive} to Live, ${result.wouldMoveToLegacy} to Legacy, ${result.alreadyInLive} already migrated`,
        'info'
      );

    } catch (error) {
      console.error('Migration preview failed:', error);
      this.addDbLogEntry(`Migration preview failed: ${error.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">👁️</span> Preview Migration';
      }
    }
  }

  async runMigration() {
    if (!confirm('Run migration? This will move images from the old structure to sessions/live folders.')) {
      return;
    }

    const btn = this.elements.runMigrationBtn;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-icon">⏳</span> Migrating...';
    }

    this.addDbLogEntry('Starting migration...', 'info');

    try {
      const response = await fetch('/api/v1/migration/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'posters-api-key-2024'
        }
      });
      const result = await response.json();

      if (result.success && result.result) {
        const r = result.result;

        if (this.elements.resultToLive) {
          this.elements.resultToLive.textContent = r.migratedToLive?.toLocaleString() || '0';
        }
        if (this.elements.resultToLegacy) {
          this.elements.resultToLegacy.textContent = r.movedToLegacySession?.toLocaleString() || '0';
        }
        if (this.elements.resultErrors) {
          this.elements.resultErrors.textContent = r.errors?.length?.toLocaleString() || '0';
        }

        if (this.elements.migrationResult) {
          this.elements.migrationResult.classList.remove('hidden');
        }
        if (this.elements.migrationPreview) {
          this.elements.migrationPreview.classList.add('hidden');
        }

        this.addDbLogEntry(
          `✓ Migration complete: ${r.migratedToLive} to Live, ${r.movedToLegacySession} to Legacy, ${r.errors?.length || 0} errors`,
          'success'
        );

        // Refresh stats
        this.checkMigrationStatus();
        this.loadDatabaseStats();
        this.loadSessions();

        // Mark browse tab as stale
        window.posterApp?.markBrowseStale();

      } else {
        throw new Error(result.error || 'Migration failed');
      }

    } catch (error) {
      console.error('Migration failed:', error);
      this.addDbLogEntry(`✗ Migration failed: ${error.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">📦</span> Run Migration';
      }
    }
  }
}

// Create and export singleton
export const processingManager = new ProcessingManager();
