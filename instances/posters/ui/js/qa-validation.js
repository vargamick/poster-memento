/**
 * QA Validation Manager
 * Handles QA validation job management, results display, and fix application
 */

import { createAPI } from './api.js';

export class QAValidationManager {
  constructor() {
    this.api = createAPI();
    this.currentJobId = null;
    this.currentReport = null;
    this.selectedResults = new Set();
    this.currentFilter = 'all';
    this.currentPage = 1;
    this.resultsPerPage = 20;
    this.pollingInterval = null;

    this.elements = {};
    this.initialized = false;
  }

  /**
   * Initialize the QA validation manager
   */
  async init() {
    if (this.initialized) return;

    this.cacheElements();
    this.bindEvents();
    await this.loadInitialStats();

    this.initialized = true;
    console.log('QAValidationManager initialized');
  }

  /**
   * Cache DOM element references
   */
  cacheElements() {
    this.elements = {
      // Overview
      totalPosters: document.getElementById('qa-total-posters'),
      validatedCount: document.getElementById('qa-validated-count'),
      warningCount: document.getElementById('qa-warning-count'),
      mismatchCount: document.getElementById('qa-mismatch-count'),

      // Configuration
      posterTypes: document.getElementById('qa-poster-types'),
      validators: document.getElementById('qa-validators'),
      batchSize: document.getElementById('qa-batch-size'),
      confidenceThreshold: document.getElementById('qa-confidence-threshold'),

      // Actions
      startBtn: document.getElementById('qa-start-btn'),
      checkHealthBtn: document.getElementById('qa-check-health-btn'),
      apiHealth: document.getElementById('qa-api-health'),
      healthMusicbrainz: document.getElementById('health-musicbrainz'),
      healthDiscogs: document.getElementById('health-discogs'),
      healthTmdb: document.getElementById('health-tmdb'),

      // Progress
      progressSection: document.getElementById('qa-progress-section'),
      progressFill: document.getElementById('qa-progress-fill'),
      progressPercent: document.getElementById('qa-progress-percent'),
      progressPhase: document.getElementById('qa-progress-phase'),
      progressLog: document.getElementById('qa-progress-log'),
      cancelBtn: document.getElementById('qa-cancel-btn'),

      // Results
      resultsSection: document.getElementById('qa-results-section'),
      overallScore: document.getElementById('qa-overall-score'),
      filterBtns: document.querySelectorAll('.qa-filter-btn'),
      selectAllBtn: document.getElementById('qa-select-all-btn'),
      fixSelectedBtn: document.getElementById('qa-fix-selected-btn'),
      fixAllBtn: document.getElementById('qa-fix-all-btn'),
      selectedCount: document.getElementById('qa-selected-count'),
      selectAllCheckbox: document.getElementById('qa-select-all-checkbox'),
      resultsTbody: document.getElementById('qa-results-tbody'),
      resultsPrevBtn: document.getElementById('qa-results-prev-btn'),
      resultsNextBtn: document.getElementById('qa-results-next-btn'),
      resultsPageInfo: document.getElementById('qa-results-page-info'),

      // Issues
      issuesSection: document.getElementById('qa-issues-section'),
      topIssues: document.getElementById('qa-top-issues')
    };
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Actions
    this.elements.startBtn?.addEventListener('click', () => this.startValidation());
    this.elements.checkHealthBtn?.addEventListener('click', () => this.checkHealth());
    this.elements.cancelBtn?.addEventListener('click', () => this.cancelValidation());

    // Filters
    this.elements.filterBtns?.forEach(btn => {
      btn.addEventListener('click', () => this.setFilter(btn.dataset.filter));
    });

    // Selection
    this.elements.selectAllBtn?.addEventListener('click', () => this.selectAllVisible());
    this.elements.selectAllCheckbox?.addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));
    this.elements.fixSelectedBtn?.addEventListener('click', () => this.fixSelected());
    this.elements.fixAllBtn?.addEventListener('click', () => this.fixAllMismatches());

    // Pagination
    this.elements.resultsPrevBtn?.addEventListener('click', () => this.prevResultsPage());
    this.elements.resultsNextBtn?.addEventListener('click', () => this.nextResultsPage());

    // Results table delegation
    this.elements.resultsTbody?.addEventListener('click', (e) => this.handleResultsClick(e));
    this.elements.resultsTbody?.addEventListener('change', (e) => this.handleResultsChange(e));
  }

  /**
   * Load initial statistics
   */
  async loadInitialStats() {
    try {
      const result = await this.api.getStatistics();
      const stats = result.data || result;

      // Find poster count
      const posterStats = stats.byType?.find(t => t.type === 'Poster');
      if (posterStats) {
        this.elements.totalPosters.textContent = posterStats.count || 0;
      }
    } catch (error) {
      console.error('Failed to load initial stats:', error);
    }
  }

  /**
   * Start a validation job
   */
  async startValidation() {
    // Gather configuration
    const posterTypes = Array.from(this.elements.posterTypes.selectedOptions).map(opt => opt.value);
    const validators = Array.from(this.elements.validators.selectedOptions).map(opt => opt.value);
    const batchSize = parseInt(this.elements.batchSize.value);
    const confidenceThreshold = parseFloat(this.elements.confidenceThreshold.value);

    // Update UI
    this.elements.startBtn.disabled = true;
    this.elements.startBtn.textContent = 'Starting...';

    try {
      const result = await this.api.startQAValidation({
        posterTypes,
        validators,
        batchSize,
        confidenceThreshold
      });

      if (result.data?.jobId) {
        this.currentJobId = result.data.jobId;
        this.showProgress();
        this.startPolling();
        this.addLogEntry('Validation job started', 'info');
      } else {
        this.addLogEntry('Failed to start validation job', 'error');
      }
    } catch (error) {
      console.error('Failed to start validation:', error);
      this.addLogEntry(`Error: ${error.message}`, 'error');
    } finally {
      this.elements.startBtn.disabled = false;
      this.elements.startBtn.textContent = 'Start Validation';
    }
  }

  /**
   * Cancel the current validation job
   */
  async cancelValidation() {
    if (!this.currentJobId) return;

    this.elements.cancelBtn.disabled = true;
    this.elements.cancelBtn.textContent = 'Cancelling...';

    try {
      await this.api.cancelQAJob(this.currentJobId);
      this.addLogEntry('Validation cancelled', 'info');
      this.stopPolling();
    } catch (error) {
      console.error('Failed to cancel validation:', error);
      this.addLogEntry(`Cancel failed: ${error.message}`, 'error');
    } finally {
      this.elements.cancelBtn.disabled = false;
      this.elements.cancelBtn.textContent = 'Cancel Validation';
    }
  }

  /**
   * Start polling for job status
   */
  startPolling() {
    this.stopPolling();
    this.pollingInterval = setInterval(() => this.pollJobStatus(), 2000);
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Poll job status
   */
  async pollJobStatus() {
    if (!this.currentJobId) {
      this.stopPolling();
      return;
    }

    try {
      const result = await this.api.getQAJobStatus(this.currentJobId);
      const job = result.data || result;

      this.updateProgress(job);

      if (job.phase === 'completed' || job.phase === 'failed' || job.phase === 'cancelled') {
        this.stopPolling();
        this.onJobComplete(job);
      }
    } catch (error) {
      console.error('Failed to poll job status:', error);
    }
  }

  /**
   * Update progress display
   */
  updateProgress(job) {
    this.elements.progressFill.style.width = `${job.progress || 0}%`;
    this.elements.progressPercent.textContent = `${job.progress || 0}%`;
    this.elements.progressPhase.textContent = this.formatPhase(job.phase);

    if (job.message && job.message !== this.lastMessage) {
      this.addLogEntry(job.message, 'info');
      this.lastMessage = job.message;
    }
  }

  /**
   * Format phase name for display
   */
  formatPhase(phase) {
    const phaseNames = {
      'pending': 'Starting...',
      'fetching_entities': 'Fetching entities...',
      'validating_artists': 'Validating artists...',
      'validating_venues': 'Validating venues...',
      'validating_dates': 'Validating dates...',
      'validating_releases': 'Validating releases...',
      'validating_poster_type': 'Inferring poster types...',
      'generating_report': 'Generating report...',
      'completed': 'Complete',
      'failed': 'Failed',
      'cancelled': 'Cancelled'
    };
    return phaseNames[phase] || phase;
  }

  /**
   * Handle job completion
   */
  async onJobComplete(job) {
    if (job.phase === 'completed') {
      this.addLogEntry(`Validation complete. ${job.stats?.processedEntities || 0} entities processed.`, 'success');
      await this.loadReport();
    } else if (job.phase === 'failed') {
      this.addLogEntry(`Validation failed: ${job.error || 'Unknown error'}`, 'error');
    } else if (job.phase === 'cancelled') {
      this.addLogEntry('Validation was cancelled', 'info');
    }

    // Update overview stats
    if (job.stats) {
      this.elements.validatedCount.textContent = job.stats.validatedCount || 0;
      this.elements.warningCount.textContent = job.stats.warningCount || 0;
      this.elements.mismatchCount.textContent = job.stats.mismatchCount || 0;
    }
  }

  /**
   * Load the validation report
   */
  async loadReport() {
    if (!this.currentJobId) return;

    try {
      const result = await this.api.getQAReport(this.currentJobId);
      this.currentReport = result.data || result;

      if (this.currentReport) {
        this.showResults();
        this.renderResults();
        this.renderTopIssues();
      }
    } catch (error) {
      console.error('Failed to load report:', error);
      this.addLogEntry(`Failed to load report: ${error.message}`, 'error');
    }
  }

  /**
   * Check external API health
   */
  async checkHealth() {
    this.elements.checkHealthBtn.disabled = true;
    this.elements.checkHealthBtn.textContent = 'Checking...';
    this.elements.apiHealth.classList.remove('hidden');

    // Reset status
    this.setHealthStatus('musicbrainz', 'checking');
    this.setHealthStatus('discogs', 'checking');
    this.setHealthStatus('tmdb', 'checking');

    try {
      const result = await this.api.checkQAHealth();
      const healthData = result.data || result;
      const apis = healthData.apis || healthData;

      // Map validator names to API names:
      // artist validator uses MusicBrainz (primary) and Discogs (secondary)
      // release validator uses TMDB for films, Discogs for music
      this.setHealthStatus('musicbrainz', apis.artist ? 'ok' : 'error');
      this.setHealthStatus('discogs', apis.artist ? 'ok' : 'error');
      this.setHealthStatus('tmdb', apis.release ? 'ok' : 'error');
    } catch (error) {
      console.error('Health check failed:', error);
      this.setHealthStatus('musicbrainz', 'error');
      this.setHealthStatus('discogs', 'error');
      this.setHealthStatus('tmdb', 'error');
    } finally {
      this.elements.checkHealthBtn.disabled = false;
      this.elements.checkHealthBtn.textContent = 'Check API Health';
    }
  }

  /**
   * Set health status for an API
   */
  setHealthStatus(api, status) {
    const element = this.elements[`health${api.charAt(0).toUpperCase() + api.slice(1)}`];
    if (!element) return;

    const statusEl = element.querySelector('.health-status');
    if (statusEl) {
      statusEl.textContent = status === 'checking' ? '...' : status === 'ok' ? '✓' : '✗';
      statusEl.className = `health-status ${status}`;
    }
  }

  /**
   * Show progress section
   */
  showProgress() {
    this.elements.progressSection.classList.remove('hidden');
    this.elements.resultsSection.classList.add('hidden');
    this.elements.issuesSection.classList.add('hidden');
    this.resetProgress();
  }

  /**
   * Show results section
   */
  showResults() {
    this.elements.progressSection.classList.add('hidden');
    this.elements.resultsSection.classList.remove('hidden');
    this.elements.issuesSection.classList.remove('hidden');

    if (this.currentReport?.summary) {
      this.elements.overallScore.textContent = `${this.currentReport.summary.overallScore}%`;
    }
  }

  /**
   * Reset progress display
   */
  resetProgress() {
    this.elements.progressFill.style.width = '0%';
    this.elements.progressPercent.textContent = '0%';
    this.elements.progressPhase.textContent = 'Starting...';
    this.elements.progressLog.innerHTML = '';
    this.elements.cancelBtn.disabled = false;
    this.elements.cancelBtn.textContent = 'Cancel Validation';
    this.lastMessage = null;
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
   * Set filter for results
   */
  setFilter(filter) {
    this.currentFilter = filter;
    this.currentPage = 1;

    // Update button states
    this.elements.filterBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    this.renderResults();
  }

  /**
   * Get filtered results
   */
  getFilteredResults() {
    if (!this.currentReport?.results) return [];

    let results = this.currentReport.results;

    if (this.currentFilter !== 'all') {
      results = results.filter(r => r.status === this.currentFilter);
    }

    return results;
  }

  /**
   * Render results table
   */
  renderResults() {
    const results = this.getFilteredResults();
    const totalPages = Math.ceil(results.length / this.resultsPerPage) || 1;
    const start = (this.currentPage - 1) * this.resultsPerPage;
    const pageResults = results.slice(start, start + this.resultsPerPage);

    if (pageResults.length === 0) {
      this.elements.resultsTbody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-results">
            No ${this.currentFilter === 'all' ? '' : this.currentFilter} results found
          </td>
        </tr>
      `;
    } else {
      this.elements.resultsTbody.innerHTML = pageResults.map(result =>
        this.renderResultRows(result)
      ).join('');
    }

    // Update pagination
    this.elements.resultsPageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
    this.elements.resultsPrevBtn.disabled = this.currentPage <= 1;
    this.elements.resultsNextBtn.disabled = this.currentPage >= totalPages;

    // Update selection count
    this.updateSelectionCount();
    this.updateFixButtons();
  }

  /**
   * Render rows for a single entity result
   */
  renderResultRows(result) {
    const suggestions = result.suggestions || [];

    if (suggestions.length === 0) {
      // No suggestions - show single row with overall status
      return `
        <tr data-entity-id="${this.escapeHtml(result.entityId)}">
          <td><input type="checkbox" class="result-checkbox" data-entity-id="${this.escapeHtml(result.entityId)}" disabled></td>
          <td class="td-poster">${this.escapeHtml(this.formatEntityName(result.entityId))}</td>
          <td colspan="4">No suggestions</td>
          <td><span class="status-badge ${result.status}">${this.escapeHtml(result.status)}</span></td>
          <td>-</td>
        </tr>
      `;
    }

    // Render a row for each suggestion
    return suggestions.map((suggestion, index) => {
      const rowId = `${result.entityId}_${suggestion.field}`;
      const isFirst = index === 0;

      return `
        <tr data-entity-id="${this.escapeHtml(result.entityId)}" data-field="${this.escapeHtml(suggestion.field)}" data-row-id="${this.escapeHtml(rowId)}">
          <td><input type="checkbox" class="result-checkbox" data-row-id="${this.escapeHtml(rowId)}" ${this.selectedResults.has(rowId) ? 'checked' : ''}></td>
          <td class="td-poster">${isFirst ? this.escapeHtml(this.formatEntityName(result.entityId)) : ''}</td>
          <td class="td-field">${this.escapeHtml(suggestion.field)}</td>
          <td class="td-current">${this.escapeHtml(suggestion.currentValue || '-')}</td>
          <td class="td-suggested">${this.escapeHtml(suggestion.suggestedValue || '-')}</td>
          <td class="td-confidence">
            <span class="confidence-badge ${this.getConfidenceClass(suggestion.confidence)}">
              ${Math.round(suggestion.confidence * 100)}%
            </span>
          </td>
          <td><span class="status-badge ${result.status}">${this.escapeHtml(result.status)}</span></td>
          <td class="td-actions">
            <button type="button" class="action-btn apply-btn" data-action="apply" data-row-id="${this.escapeHtml(rowId)}">Apply</button>
            <button type="button" class="action-btn ignore-btn" data-action="ignore" data-row-id="${this.escapeHtml(rowId)}">Ignore</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Get confidence class for styling
   */
  getConfidenceClass(confidence) {
    if (confidence >= 0.9) return 'high';
    if (confidence >= 0.7) return 'medium';
    return 'low';
  }

  /**
   * Format entity name for display
   */
  formatEntityName(name) {
    return name
      .replace(/^poster_/i, '')
      .replace(/_/g, ' ')
      .slice(0, 30);
  }

  /**
   * Render top issues section
   */
  renderTopIssues() {
    const issues = this.currentReport?.summary?.topIssues || [];

    if (issues.length === 0) {
      this.elements.topIssues.innerHTML = '<p>No significant issues found.</p>';
      return;
    }

    this.elements.topIssues.innerHTML = issues.map(issue => `
      <div class="issue-item">
        <span class="issue-field">${this.escapeHtml(issue.field)}</span>
        <span class="issue-count">${issue.count} occurrences</span>
        <span class="issue-type">${this.escapeHtml(issue.issueType)}</span>
      </div>
    `).join('');
  }

  /**
   * Handle clicks in results table
   */
  handleResultsClick(e) {
    const actionBtn = e.target.closest('.action-btn');
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      const rowId = actionBtn.dataset.rowId;

      if (action === 'apply') {
        this.applyFix(rowId);
      } else if (action === 'ignore') {
        this.ignoreSuggestion(rowId);
      }
    }
  }

  /**
   * Handle checkbox changes in results table
   */
  handleResultsChange(e) {
    if (e.target.classList.contains('result-checkbox')) {
      const rowId = e.target.dataset.rowId;
      if (e.target.checked) {
        this.selectedResults.add(rowId);
      } else {
        this.selectedResults.delete(rowId);
      }
      this.updateSelectionCount();
      this.updateFixButtons();
    }
  }

  /**
   * Select all visible results
   */
  selectAllVisible() {
    const checkboxes = this.elements.resultsTbody.querySelectorAll('.result-checkbox:not(:disabled)');
    checkboxes.forEach(cb => {
      cb.checked = true;
      if (cb.dataset.rowId) {
        this.selectedResults.add(cb.dataset.rowId);
      }
    });
    this.updateSelectionCount();
    this.updateFixButtons();
  }

  /**
   * Toggle select all
   */
  toggleSelectAll(checked) {
    const checkboxes = this.elements.resultsTbody.querySelectorAll('.result-checkbox:not(:disabled)');
    checkboxes.forEach(cb => {
      cb.checked = checked;
      if (cb.dataset.rowId) {
        if (checked) {
          this.selectedResults.add(cb.dataset.rowId);
        } else {
          this.selectedResults.delete(cb.dataset.rowId);
        }
      }
    });
    this.updateSelectionCount();
    this.updateFixButtons();
  }

  /**
   * Update selection count display
   */
  updateSelectionCount() {
    this.elements.selectedCount.textContent = this.selectedResults.size;
  }

  /**
   * Update fix button states
   */
  updateFixButtons() {
    this.elements.fixSelectedBtn.disabled = this.selectedResults.size === 0;

    // Count mismatches that have suggestions
    const mismatchCount = this.currentReport?.results?.filter(r =>
      r.status === 'mismatch' && r.suggestions?.length > 0
    ).length || 0;
    this.elements.fixAllBtn.disabled = mismatchCount === 0;
  }

  /**
   * Apply a single fix
   */
  async applyFix(rowId) {
    const [entityId, field] = this.parseRowId(rowId);
    const suggestion = this.findSuggestion(entityId, field);

    if (!suggestion) {
      console.error('Suggestion not found:', rowId);
      return;
    }

    try {
      await this.api.applyQAFix(entityId, field, suggestion.suggestedValue);
      this.addLogEntry(`Applied fix: ${field} for ${this.formatEntityName(entityId)}`, 'success');

      // Remove from view
      const row = this.elements.resultsTbody.querySelector(`[data-row-id="${rowId}"]`);
      if (row) {
        row.remove();
      }
      this.selectedResults.delete(rowId);
      this.updateSelectionCount();
    } catch (error) {
      console.error('Failed to apply fix:', error);
      this.addLogEntry(`Failed to apply fix: ${error.message}`, 'error');
    }
  }

  /**
   * Ignore a suggestion
   */
  ignoreSuggestion(rowId) {
    const row = this.elements.resultsTbody.querySelector(`[data-row-id="${rowId}"]`);
    if (row) {
      row.classList.add('ignored');
      row.querySelector('.action-btn.apply-btn').disabled = true;
      row.querySelector('.action-btn.ignore-btn').disabled = true;
    }
    this.selectedResults.delete(rowId);
    this.updateSelectionCount();
  }

  /**
   * Fix selected suggestions
   */
  async fixSelected() {
    if (this.selectedResults.size === 0) return;

    this.elements.fixSelectedBtn.disabled = true;
    this.elements.fixSelectedBtn.textContent = 'Fixing...';

    const fixes = [];
    for (const rowId of this.selectedResults) {
      const [entityId, field] = this.parseRowId(rowId);
      const suggestion = this.findSuggestion(entityId, field);
      if (suggestion) {
        fixes.push({
          entityId,
          field,
          value: suggestion.suggestedValue
        });
      }
    }

    try {
      if (fixes.length > 0) {
        await this.api.applyQAFixBatch(fixes);
        this.addLogEntry(`Applied ${fixes.length} fixes`, 'success');

        // Remove fixed rows
        for (const rowId of this.selectedResults) {
          const row = this.elements.resultsTbody.querySelector(`[data-row-id="${rowId}"]`);
          if (row) row.remove();
        }
        this.selectedResults.clear();
        this.updateSelectionCount();
      }
    } catch (error) {
      console.error('Failed to apply fixes:', error);
      this.addLogEntry(`Failed to apply fixes: ${error.message}`, 'error');
    } finally {
      this.elements.fixSelectedBtn.disabled = false;
      this.elements.fixSelectedBtn.textContent = 'Fix Selected';
    }
  }

  /**
   * Fix all mismatches
   */
  async fixAllMismatches() {
    const mismatches = this.currentReport?.results?.filter(r =>
      r.status === 'mismatch' && r.suggestions?.length > 0
    ) || [];

    if (mismatches.length === 0) return;

    const confirmed = confirm(`This will apply ${mismatches.reduce((sum, r) => sum + r.suggestions.length, 0)} fixes. Continue?`);
    if (!confirmed) return;

    this.elements.fixAllBtn.disabled = true;
    this.elements.fixAllBtn.textContent = 'Fixing...';

    const fixes = [];
    for (const result of mismatches) {
      for (const suggestion of result.suggestions) {
        fixes.push({
          entityId: result.entityId,
          field: suggestion.field,
          value: suggestion.suggestedValue
        });
      }
    }

    try {
      await this.api.applyQAFixBatch(fixes);
      this.addLogEntry(`Applied ${fixes.length} fixes`, 'success');

      // Reload report
      await this.loadReport();
    } catch (error) {
      console.error('Failed to apply fixes:', error);
      this.addLogEntry(`Failed to apply fixes: ${error.message}`, 'error');
    } finally {
      this.elements.fixAllBtn.disabled = false;
      this.elements.fixAllBtn.textContent = 'Fix All Mismatches';
    }
  }

  /**
   * Parse row ID into entityId and field
   */
  parseRowId(rowId) {
    const lastUnderscoreIndex = rowId.lastIndexOf('_');
    const entityId = rowId.slice(0, lastUnderscoreIndex);
    const field = rowId.slice(lastUnderscoreIndex + 1);
    return [entityId, field];
  }

  /**
   * Find suggestion by entityId and field
   */
  findSuggestion(entityId, field) {
    const result = this.currentReport?.results?.find(r => r.entityId === entityId);
    return result?.suggestions?.find(s => s.field === field);
  }

  /**
   * Previous results page
   */
  prevResultsPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.renderResults();
    }
  }

  /**
   * Next results page
   */
  nextResultsPage() {
    const results = this.getFilteredResults();
    const totalPages = Math.ceil(results.length / this.resultsPerPage);
    if (this.currentPage < totalPages) {
      this.currentPage++;
      this.renderResults();
    }
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    if (text == null) return '';
    if (typeof text !== 'string') return String(text);
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Create and export singleton instance
export const qaValidationManager = new QAValidationManager();

// Auto-initialize when QA validation tab is shown (handled by app.js)
