/**
 * Poster Memento UI Application
 * Main application logic for browsing and searching posters
 */

import { createAPI, APIError } from './api.js';

class PosterApp {
  constructor() {
    // State
    this.currentPage = 1;
    this.limit = 10;
    this.totalPosters = 0;
    this.currentSearch = '';
    this.searchStrategy = 'hybrid';
    this.posters = [];
    this.isLoading = false;

    // API client
    this.api = createAPI();

    // DOM elements
    this.elements = {
      searchInput: document.getElementById('search-input'),
      searchStrategy: document.getElementById('search-strategy'),
      searchBtn: document.getElementById('search-btn'),
      clearBtn: document.getElementById('clear-btn'),
      limitSelect: document.getElementById('limit-select'),
      prevBtn: document.getElementById('prev-btn'),
      nextBtn: document.getElementById('next-btn'),
      pageInfo: document.getElementById('page-info'),
      totalCount: document.getElementById('total-count'),
      posterGrid: document.getElementById('poster-grid'),
      loading: document.getElementById('loading'),
      error: document.getElementById('error'),
      errorMessage: document.getElementById('error-message'),
      retryBtn: document.getElementById('retry-btn'),
      modal: document.getElementById('poster-modal'),
      modalClose: document.getElementById('modal-close'),
      posterDetail: document.getElementById('poster-detail')
    };

    // Bind event handlers
    this.bindEvents();

    // Initial load
    this.loadPosters();
  }

  /**
   * Bind all event handlers
   */
  bindEvents() {
    // Search
    this.elements.searchBtn.addEventListener('click', () => this.handleSearch());
    this.elements.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleSearch();
    });
    this.elements.clearBtn.addEventListener('click', () => this.handleClear());
    this.elements.searchStrategy.addEventListener('change', (e) => {
      this.searchStrategy = e.target.value;
    });

    // Pagination
    this.elements.prevBtn.addEventListener('click', () => this.goToPage(this.currentPage - 1));
    this.elements.nextBtn.addEventListener('click', () => this.goToPage(this.currentPage + 1));
    this.elements.limitSelect.addEventListener('change', (e) => {
      this.limit = parseInt(e.target.value, 10);
      this.currentPage = 1;
      this.loadPosters();
    });

    // Modal
    this.elements.modalClose.addEventListener('click', () => this.closeModal());
    this.elements.modal.addEventListener('click', (e) => {
      if (e.target === this.elements.modal) this.closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModal();
    });

    // Retry
    this.elements.retryBtn.addEventListener('click', () => this.loadPosters());
  }

  /**
   * Handle search action
   */
  handleSearch() {
    const query = this.elements.searchInput.value.trim();
    this.currentSearch = query;
    this.currentPage = 1;
    this.loadPosters();
  }

  /**
   * Handle clear search
   */
  handleClear() {
    this.elements.searchInput.value = '';
    this.currentSearch = '';
    this.currentPage = 1;
    this.loadPosters();
  }

  /**
   * Navigate to a specific page
   * @param {number} page - Page number
   */
  goToPage(page) {
    if (page < 1 || page > this.getTotalPages()) return;
    this.currentPage = page;
    this.loadPosters();
  }

  /**
   * Get total number of pages
   * @returns {number} Total pages
   */
  getTotalPages() {
    return Math.ceil(this.totalPosters / this.limit);
  }

  /**
   * Load posters from API
   */
  async loadPosters() {
    if (this.isLoading) return;

    this.isLoading = true;
    this.showLoading(true);
    this.showError(false);

    try {
      let result;
      const offset = (this.currentPage - 1) * this.limit;

      if (this.currentSearch) {
        // Use search endpoint
        result = await this.api.searchPosters(this.currentSearch, {
          limit: this.limit,
          strategy: this.searchStrategy
        });

        // Handle search response format
        if (result.data?.results) {
          this.posters = result.data.results;
          this.totalPosters = result.data.total || this.posters.length;
        } else if (Array.isArray(result.data)) {
          this.posters = result.data;
          this.totalPosters = this.posters.length;
        } else {
          this.posters = [];
          this.totalPosters = 0;
        }
      } else {
        // Use entities endpoint
        result = await this.api.getPosters({
          limit: this.limit,
          offset
        });

        // Handle entities response format
        if (result.data?.entities) {
          this.posters = result.data.entities;
          this.totalPosters = result.pagination?.total || result.data.total || this.posters.length;
        } else if (Array.isArray(result.data)) {
          this.posters = result.data;
          this.totalPosters = result.total || this.posters.length;
        } else {
          this.posters = [];
          this.totalPosters = 0;
        }
      }

      this.renderPosters();
      this.updatePagination();
    } catch (error) {
      console.error('Failed to load posters:', error);
      this.showError(true, this.getErrorMessage(error));
    } finally {
      this.isLoading = false;
      this.showLoading(false);
    }
  }

  /**
   * Get user-friendly error message
   * @param {Error} error - Error object
   * @returns {string} Error message
   */
  getErrorMessage(error) {
    if (error instanceof APIError) {
      if (error.isAuthError()) {
        return 'Authentication failed. Please check your API key.';
      }
      if (error.isNotFound()) {
        return 'Resource not found.';
      }
      if (error.isServerError()) {
        return 'Server error. Please try again later.';
      }
      return error.message;
    }
    return 'Failed to connect to the server. Please check if the API is running.';
  }

  /**
   * Show/hide loading state
   * @param {boolean} show - Whether to show loading
   */
  showLoading(show) {
    this.elements.loading.classList.toggle('hidden', !show);
    this.elements.posterGrid.classList.toggle('hidden', show);
  }

  /**
   * Show/hide error state
   * @param {boolean} show - Whether to show error
   * @param {string} message - Error message
   */
  showError(show, message = '') {
    this.elements.error.classList.toggle('hidden', !show);
    if (message) {
      this.elements.errorMessage.textContent = message;
    }
  }

  /**
   * Render posters in the grid
   */
  renderPosters() {
    if (this.posters.length === 0) {
      this.elements.posterGrid.innerHTML = `
        <div class="empty-state">
          <h3>No posters found</h3>
          <p>${this.currentSearch ? 'Try a different search term.' : 'No posters in the collection yet.'}</p>
        </div>
      `;
      return;
    }

    this.elements.posterGrid.innerHTML = this.posters.map(poster => this.renderPosterCard(poster)).join('');

    // Add click handlers to cards
    this.elements.posterGrid.querySelectorAll('.poster-card').forEach((card, index) => {
      card.addEventListener('click', () => this.openPosterDetail(this.posters[index]));
    });
  }

  /**
   * Render a single poster card
   * @param {object} poster - Poster entity
   * @returns {string} HTML string
   */
  renderPosterCard(poster) {
    const name = poster.name || 'Untitled';
    const entityType = poster.entityType || 'Poster';
    const observations = poster.observations || [];
    const observationsText = observations.slice(0, 3).join(' ');
    const createdAt = poster.createdAt ? new Date(poster.createdAt).toLocaleDateString() : '';

    return `
      <div class="poster-card" data-name="${this.escapeHtml(name)}">
        <div class="poster-card-header">
          <h3>${this.escapeHtml(this.formatPosterName(name))}</h3>
          <span class="poster-type">${this.escapeHtml(entityType)}</span>
        </div>
        <div class="poster-card-body">
          <p class="poster-observations">
            ${observationsText ? this.escapeHtml(observationsText) : '<em>No description available</em>'}
          </p>
          <div class="poster-meta">
            ${createdAt ? `<span class="meta-tag">Added: ${createdAt}</span>` : ''}
            ${observations.length > 0 ? `<span class="meta-tag">${observations.length} observations</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Format poster name for display
   * @param {string} name - Raw entity name
   * @returns {string} Formatted name
   */
  formatPosterName(name) {
    // Remove common prefixes and format nicely
    return name
      .replace(/^poster_/i, '')
      .replace(/_/g, ' ')
      .replace(/\.(jpg|jpeg|png|gif|webp)$/i, '')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Update pagination controls
   */
  updatePagination() {
    const totalPages = this.getTotalPages();

    this.elements.totalCount.textContent = this.totalPosters;
    this.elements.pageInfo.textContent = `Page ${this.currentPage} of ${totalPages || 1}`;
    this.elements.prevBtn.disabled = this.currentPage <= 1;
    this.elements.nextBtn.disabled = this.currentPage >= totalPages;
  }

  /**
   * Open poster detail modal
   * @param {object} poster - Poster entity
   */
  async openPosterDetail(poster) {
    this.elements.modal.classList.remove('hidden');
    this.elements.posterDetail.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading details...</p></div>';

    try {
      // Get full poster details with relations
      const result = await this.api.getPoster(poster.name);
      const fullPoster = result.data || result;

      // Try to get relations
      let relations = [];
      try {
        const relResult = await this.api.getPosterRelations(poster.name);
        relations = relResult.data?.relations || relResult.relations || [];
      } catch (e) {
        console.warn('Could not load relations:', e);
      }

      this.renderPosterDetail(fullPoster, relations);
    } catch (error) {
      console.error('Failed to load poster details:', error);
      this.elements.posterDetail.innerHTML = `
        <div class="error">
          <p>Failed to load poster details: ${this.getErrorMessage(error)}</p>
        </div>
      `;
    }
  }

  /**
   * Render poster detail view
   * @param {object} poster - Poster entity
   * @param {array} relations - Poster relations
   */
  renderPosterDetail(poster, relations = []) {
    const name = poster.name || 'Untitled';
    const entityType = poster.entityType || 'Poster';
    const observations = poster.observations || [];
    const createdAt = poster.createdAt ? new Date(poster.createdAt).toLocaleString() : 'Unknown';
    const id = poster.id || 'N/A';

    const relationsHtml = relations.length > 0 ? `
      <div class="detail-section">
        <h3>Relations</h3>
        <div class="relations-list">
          ${relations.map(rel => `
            <div class="relation-tag">
              <span class="relation-type">${this.escapeHtml(rel.relationType || rel.type || 'Related')}</span>
              <span class="relation-name">${this.escapeHtml(rel.to || rel.target || rel.name || 'Unknown')}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    this.elements.posterDetail.innerHTML = `
      <div class="detail-header">
        <h2>${this.escapeHtml(this.formatPosterName(name))}</h2>
        <span class="detail-type">${this.escapeHtml(entityType)}</span>
      </div>

      ${observations.length > 0 ? `
        <div class="detail-section">
          <h3>Observations</h3>
          <ul class="observations-list">
            ${observations.map(obs => `<li>${this.escapeHtml(obs)}</li>`).join('')}
          </ul>
        </div>
      ` : '<p class="detail-section"><em>No observations recorded.</em></p>'}

      ${relationsHtml}

      <div class="detail-meta">
        <p><strong>Entity Name:</strong> ${this.escapeHtml(name)}</p>
        <p><strong>ID:</strong> ${this.escapeHtml(id)}</p>
        <p><strong>Created:</strong> ${createdAt}</p>
      </div>
    `;
  }

  /**
   * Close the modal
   */
  closeModal() {
    this.elements.modal.classList.add('hidden');
    this.elements.posterDetail.innerHTML = '';
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    if (typeof text !== 'string') return String(text);
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.posterApp = new PosterApp();
});
