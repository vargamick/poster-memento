/**
 * Poster Memento UI Application
 * Main application logic for browsing and searching posters
 * Table-based view with sortable columns and image thumbnails
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
    this.sortColumn = 'createdAt';
    this.sortDirection = 'desc';
    this.imageUrls = {}; // Cache: hash -> presigned URL

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
      posterTable: document.getElementById('poster-table'),
      posterTbody: document.getElementById('poster-tbody'),
      tableContainer: document.querySelector('.table-container'),
      emptyState: document.getElementById('empty-state'),
      loading: document.getElementById('loading'),
      error: document.getElementById('error'),
      errorMessage: document.getElementById('error-message'),
      retryBtn: document.getElementById('retry-btn'),
      modal: document.getElementById('poster-modal'),
      modalClose: document.getElementById('modal-close'),
      posterDetail: document.getElementById('poster-detail'),
      lightbox: document.getElementById('lightbox-modal'),
      lightboxClose: document.getElementById('lightbox-close'),
      lightboxImage: document.getElementById('lightbox-image'),
      lightboxCaption: document.getElementById('lightbox-caption'),
      lightboxBackdrop: document.querySelector('.lightbox-backdrop')
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

    // Sortable columns
    document.querySelectorAll('.poster-table th.sortable').forEach(th => {
      th.addEventListener('click', () => this.handleSort(th.dataset.sort));
    });

    // Detail Modal
    this.elements.modalClose.addEventListener('click', () => this.closeModal());
    this.elements.modal.addEventListener('click', (e) => {
      if (e.target === this.elements.modal) this.closeModal();
    });

    // Lightbox Modal
    this.elements.lightboxClose.addEventListener('click', () => this.closeLightbox());
    this.elements.lightboxBackdrop.addEventListener('click', () => this.closeLightbox());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeLightbox();
        this.closeModal();
      }
    });

    // Retry
    this.elements.retryBtn.addEventListener('click', () => this.loadPosters());
  }

  /**
   * Handle column sort
   */
  handleSort(column) {
    if (this.sortColumn === column) {
      // Toggle direction
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // New column, default to desc
      this.sortColumn = column;
      this.sortDirection = 'desc';
    }

    // Update UI indicators
    document.querySelectorAll('.poster-table th.sortable').forEach(th => {
      th.classList.remove('active', 'asc', 'desc');
      if (th.dataset.sort === this.sortColumn) {
        th.classList.add('active', this.sortDirection);
      }
    });

    // Reload with new sort
    this.currentPage = 1;
    this.loadPosters();
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
   */
  goToPage(page) {
    if (page < 1 || page > this.getTotalPages()) return;
    this.currentPage = page;
    this.loadPosters();
  }

  /**
   * Get total number of pages
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
        // Use entities endpoint with sort params
        result = await this.api.getPosters({
          limit: this.limit,
          offset,
          sortBy: this.sortColumn,
          sortOrder: this.sortDirection
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

      this.renderTable();
      this.updatePagination();

      // Load image URLs after rendering (non-blocking)
      this.loadImageUrls();
    } catch (error) {
      console.error('Failed to load posters:', error);
      this.showError(true, this.getErrorMessage(error));
    } finally {
      this.isLoading = false;
      this.showLoading(false);
    }
  }

  /**
   * Load presigned URLs for poster images
   */
  async loadImageUrls() {
    // Collect hashes that we don't have URLs for yet
    const hashes = [];
    for (const poster of this.posters) {
      const hash = poster.metadata?.source_image_hash;
      if (hash && !this.imageUrls[hash]) {
        hashes.push(hash);
      }
    }

    if (hashes.length === 0) return;

    try {
      const result = await this.api.getImageUrls(hashes);
      if (result.data?.urls) {
        // Update cache
        Object.assign(this.imageUrls, result.data.urls);
        // Update displayed thumbnails
        this.updateThumbnails();
      }
    } catch (error) {
      console.warn('Failed to load image URLs:', error);
    }
  }

  /**
   * Update thumbnail images after URLs are loaded
   */
  updateThumbnails() {
    for (const poster of this.posters) {
      const hash = poster.metadata?.source_image_hash;
      if (hash && this.imageUrls[hash]) {
        const wrapper = document.querySelector(`[data-hash="${hash}"]`);
        if (wrapper && wrapper.classList.contains('thumbnail-loading')) {
          wrapper.classList.remove('thumbnail-loading');
          wrapper.classList.add('thumbnail-wrapper');
          wrapper.innerHTML = `<img src="${this.escapeHtml(this.imageUrls[hash])}" alt="${this.escapeHtml(poster.name)}" loading="lazy">`;
        }
      }
    }
  }

  /**
   * Get user-friendly error message
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
   */
  showLoading(show) {
    this.elements.loading.classList.toggle('hidden', !show);
    this.elements.tableContainer.classList.toggle('hidden', show);
    this.elements.emptyState.classList.add('hidden');
  }

  /**
   * Show/hide error state
   */
  showError(show, message = '') {
    this.elements.error.classList.toggle('hidden', !show);
    if (message) {
      this.elements.errorMessage.textContent = message;
    }
  }

  /**
   * Render posters in the table
   */
  renderTable() {
    if (this.posters.length === 0) {
      this.elements.tableContainer.classList.add('hidden');
      this.elements.emptyState.classList.remove('hidden');
      this.elements.emptyState.querySelector('p').textContent =
        this.currentSearch ? 'Try a different search term.' : 'No posters in the collection yet.';
      return;
    }

    this.elements.tableContainer.classList.remove('hidden');
    this.elements.emptyState.classList.add('hidden');

    this.elements.posterTbody.innerHTML = this.posters.map((poster, index) =>
      this.renderTableRow(poster, index)
    ).join('');

    // Add click handlers
    this.elements.posterTbody.querySelectorAll('tr').forEach((row, index) => {
      // Thumbnail click -> lightbox
      const thumbnail = row.querySelector('.thumbnail-wrapper, .thumbnail-loading, .thumbnail-placeholder');
      if (thumbnail) {
        thumbnail.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openLightbox(this.posters[index]);
        });
      }

      // Name cell click -> detail modal
      const nameCell = row.querySelector('.td-name');
      if (nameCell) {
        nameCell.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openPosterDetail(this.posters[index]);
        });
      }
    });
  }

  /**
   * Render a single table row
   */
  renderTableRow(poster, index) {
    const name = poster.name || 'Untitled';
    const posterType = poster.poster_type || 'unknown';
    const createdAt = poster.createdAt ? new Date(poster.createdAt).toLocaleDateString() : '-';
    const eventDate = poster.event_date || poster.date || '-';
    const venueName = poster.venue_name || '-';
    const hash = poster.metadata?.source_image_hash;

    // Build artists display
    const artistsHtml = this.renderArtists(poster);

    // Thumbnail: show loading state, actual image loaded async
    let thumbnailHtml;
    if (hash && this.imageUrls[hash]) {
      thumbnailHtml = `
        <div class="thumbnail-wrapper" data-hash="${this.escapeHtml(hash)}">
          <img src="${this.escapeHtml(this.imageUrls[hash])}" alt="${this.escapeHtml(name)}" loading="lazy">
        </div>`;
    } else if (hash) {
      thumbnailHtml = `
        <div class="thumbnail-loading" data-hash="${this.escapeHtml(hash)}">
          <div class="mini-spinner"></div>
        </div>`;
    } else {
      thumbnailHtml = `<div class="thumbnail-placeholder">🎨</div>`;
    }

    return `
      <tr data-index="${index}">
        <td class="td-thumbnail">${thumbnailHtml}</td>
        <td class="td-name">${this.escapeHtml(this.formatPosterName(name))}</td>
        <td><span class="type-badge ${posterType}">${this.escapeHtml(posterType)}</span></td>
        <td class="artists-cell">${artistsHtml}</td>
        <td>${this.escapeHtml(venueName)}</td>
        <td>${this.escapeHtml(eventDate)}</td>
        <td>${createdAt}</td>
      </tr>
    `;
  }

  /**
   * Render artists column content
   */
  renderArtists(poster) {
    const headliner = poster.headliner;
    const supporting = poster.supporting_acts || [];
    const parts = [];

    if (headliner) {
      parts.push(`<span class="headliner">${this.escapeHtml(headliner)}</span>`);
    }

    if (supporting.length > 0) {
      const displaySupporting = supporting.slice(0, 2);
      const supportingText = displaySupporting.join(', ');
      parts.push(`<span class="supporting">${this.escapeHtml(supportingText)}</span>`);

      if (supporting.length > 2) {
        parts.push(`<span class="more-artists">+${supporting.length - 2} more</span>`);
      }
    }

    return parts.length > 0 ? parts.join('<br>') : '-';
  }

  /**
   * Format poster name for display
   */
  formatPosterName(name) {
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
   * Open lightbox with poster image
   */
  openLightbox(poster) {
    const hash = poster.metadata?.source_image_hash;
    const imageUrl = hash ? this.imageUrls[hash] : null;

    if (!imageUrl) {
      // No image available
      return;
    }

    this.elements.lightboxImage.src = imageUrl;
    this.elements.lightboxCaption.textContent = this.formatPosterName(poster.name);
    this.elements.lightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Close lightbox
   */
  closeLightbox() {
    this.elements.lightbox.classList.add('hidden');
    this.elements.lightboxImage.src = '';
    document.body.style.overflow = '';
  }

  /**
   * Open poster detail modal
   */
  async openPosterDetail(poster) {
    this.elements.modal.classList.remove('hidden');
    this.elements.posterDetail.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading details...</p></div>';
    document.body.style.overflow = 'hidden';

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
   * Render poster detail view with new data model fields
   */
  renderPosterDetail(poster, relations = []) {
    const name = poster.name || 'Untitled';
    const entityType = poster.entityType || 'Poster';
    const posterType = poster.poster_type || 'unknown';
    const observations = poster.observations || [];
    const createdAt = poster.createdAt ? new Date(poster.createdAt).toLocaleString() : 'Unknown';
    const id = poster.id || 'N/A';
    const visualElements = poster.visual_elements || {};
    const hash = poster.metadata?.source_image_hash;
    const imageUrl = hash ? this.imageUrls[hash] : null;

    // Group relations by type
    const headliners = relations.filter(r => r.relationType === 'HEADLINED_ON');
    const performers = relations.filter(r => r.relationType === 'PERFORMED_ON' || r.relationType === 'FEATURES_ARTIST');
    const venues = relations.filter(r => r.relationType === 'ADVERTISES_VENUE');
    const events = relations.filter(r => r.relationType === 'ADVERTISES_EVENT');
    const otherRelations = relations.filter(r =>
      !['HEADLINED_ON', 'PERFORMED_ON', 'FEATURES_ARTIST', 'ADVERTISES_VENUE', 'ADVERTISES_EVENT'].includes(r.relationType)
    );

    // Build visual elements section
    let visualHtml = '';
    if (Object.keys(visualElements).length > 0) {
      const items = [];
      if (visualElements.style) items.push(`<strong>Style:</strong> ${this.escapeHtml(visualElements.style)}`);
      if (visualElements.dominant_colors?.length) items.push(`<strong>Colors:</strong> ${visualElements.dominant_colors.map(c => this.escapeHtml(c)).join(', ')}`);
      if (visualElements.has_artist_photo) items.push('✓ Artist photo');
      if (visualElements.has_album_artwork) items.push('✓ Album artwork');
      if (visualElements.has_logo) items.push('✓ Logo');

      if (items.length > 0) {
        visualHtml = `
          <div class="detail-section">
            <h3>Visual Elements</h3>
            <div class="visual-elements-list">
              ${items.map(item => `<span class="meta-tag">${item}</span>`).join(' ')}
            </div>
          </div>
        `;
      }
    }

    // Build relations sections
    const renderRelationGroup = (title, rels) => {
      if (rels.length === 0) return '';
      return `
        <div class="detail-section">
          <h3>${title}</h3>
          <div class="relations-list">
            ${rels.map(rel => `
              <div class="relation-tag">
                <span class="relation-name">${this.escapeHtml(rel.to || rel.target || rel.name || 'Unknown')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    };

    this.elements.posterDetail.innerHTML = `
      <div class="detail-header">
        ${imageUrl ? `<img src="${this.escapeHtml(imageUrl)}" alt="${this.escapeHtml(name)}" class="detail-image" style="max-width: 200px; max-height: 200px; object-fit: contain; margin-bottom: 15px; border-radius: var(--radius); cursor: pointer;" onclick="window.posterApp.openLightbox(${JSON.stringify(poster).replace(/"/g, '&quot;')})">` : ''}
        <h2>${this.escapeHtml(this.formatPosterName(name))}</h2>
        <span class="detail-type">${this.escapeHtml(entityType)}</span>
        <span class="type-badge ${posterType}" style="margin-left: 8px;">${this.escapeHtml(posterType)}</span>
      </div>

      ${visualHtml}

      ${observations.length > 0 ? `
        <div class="detail-section">
          <h3>Observations</h3>
          <ul class="observations-list">
            ${observations.map(obs => `<li>${this.escapeHtml(obs)}</li>`).join('')}
          </ul>
        </div>
      ` : '<p class="detail-section"><em>No observations recorded.</em></p>'}

      ${renderRelationGroup('Headliners', headliners)}
      ${renderRelationGroup('Supporting Acts', performers)}
      ${renderRelationGroup('Venue', venues)}
      ${renderRelationGroup('Event', events)}
      ${renderRelationGroup('Other Relations', otherRelations)}

      <div class="detail-meta">
        <p><strong>Entity Name:</strong> ${this.escapeHtml(name)}</p>
        <p><strong>ID:</strong> ${this.escapeHtml(id)}</p>
        <p><strong>Created:</strong> ${createdAt}</p>
        ${poster.event_date ? `<p><strong>Event Date:</strong> ${this.escapeHtml(poster.event_date)}</p>` : ''}
        ${poster.ticket_price ? `<p><strong>Ticket Price:</strong> ${this.escapeHtml(poster.ticket_price)}</p>` : ''}
        ${poster.door_time ? `<p><strong>Door Time:</strong> ${this.escapeHtml(poster.door_time)}</p>` : ''}
        ${poster.show_time ? `<p><strong>Show Time:</strong> ${this.escapeHtml(poster.show_time)}</p>` : ''}
      </div>
    `;
  }

  /**
   * Close the modal
   */
  closeModal() {
    this.elements.modal.classList.add('hidden');
    this.elements.posterDetail.innerHTML = '';
    document.body.style.overflow = '';
  }

  /**
   * Escape HTML to prevent XSS
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
