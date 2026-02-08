/**
 * Poster Memento UI Application
 * Main application logic for browsing and searching posters
 * Table-based view with sortable columns and image thumbnails
 */

import { createAPI, APIError } from './api.js';
import { processingManager } from './processing.js';
import { qaValidationManager } from './qa-validation.js';

class PosterApp {
  constructor() {
    // State
    this.currentPage = 1;
    this.currentTab = 'browse';
    this.processingInitialized = false;
    this.databaseInitialized = false;
    this.qaValidationInitialized = false;
    this.limit = 10;
    this.totalPosters = 0;
    this.currentSearch = '';
    this.searchStrategy = 'hybrid';
    this.posters = [];
    this.isLoading = false;
    this.sortColumn = 'createdAt';
    this.sortDirection = 'desc';
    this.imageUrls = {}; // Cache: hash -> presigned URL

    // Filter state for clickable links (artist, venue, type)
    this.activeFilter = null; // { type: 'artist'|'venue'|'posterType', value: string }

    // Stale flag: set when other tabs modify data, triggers refresh on browse tab switch
    this.browseStale = false;

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
      lightboxBackdrop: document.querySelector('.lightbox-backdrop'),
      // Tabs
      tabButtons: document.querySelectorAll('.tab-btn'),
      browseTab: document.getElementById('browse-tab'),
      processingTab: document.getElementById('processing-tab'),
      databaseTab: document.getElementById('database-tab'),
      qaValidationTab: document.getElementById('qa-validation-tab')
    };

    // Bind event handlers
    this.bindEvents();
    this.bindTabEvents();

    // Create filter bar UI
    this.createFilterBar();

    // Parse URL for initial filter state
    this.parseUrlFilters();

    // Initial load
    this.loadPosters();
  }

  /**
   * Create the filter bar UI element (inserted before table)
   */
  createFilterBar() {
    const filterBar = document.createElement('div');
    filterBar.id = 'filter-bar';
    filterBar.className = 'filter-bar hidden';
    filterBar.innerHTML = `
      <div class="filter-bar-content">
        <span class="filter-label">Filtering by:</span>
        <span class="filter-type" id="filter-type-label"></span>
        <span class="filter-value" id="filter-value-label"></span>
        <button class="filter-clear-btn" id="filter-clear-btn" title="Clear filter">&times;</button>
      </div>
    `;

    // Insert before the table container
    const tableContainer = this.elements.tableContainer;
    tableContainer.parentNode.insertBefore(filterBar, tableContainer);

    // Store reference
    this.elements.filterBar = filterBar;
    this.elements.filterTypeLabel = document.getElementById('filter-type-label');
    this.elements.filterValueLabel = document.getElementById('filter-value-label');
    this.elements.filterClearBtn = document.getElementById('filter-clear-btn');

    // Bind clear button
    this.elements.filterClearBtn.addEventListener('click', () => this.clearFilter());
  }

  /**
   * Parse URL query params for initial filter state
   */
  parseUrlFilters() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('artist')) {
      this.activeFilter = { type: 'artist', value: params.get('artist') };
    } else if (params.has('venue')) {
      this.activeFilter = { type: 'venue', value: params.get('venue') };
    } else if (params.has('posterType')) {
      this.activeFilter = { type: 'posterType', value: params.get('posterType') };
    }

    if (this.activeFilter) {
      this.updateFilterBar();
    }
  }

  /**
   * Update URL with current filter state
   */
  updateUrlWithFilter() {
    const url = new URL(window.location.href);

    // Clear existing filter params
    url.searchParams.delete('artist');
    url.searchParams.delete('venue');
    url.searchParams.delete('posterType');

    // Set new filter param if active
    if (this.activeFilter) {
      url.searchParams.set(this.activeFilter.type, this.activeFilter.value);
    }

    // Update URL without reload
    window.history.pushState({}, '', url);
  }

  /**
   * Set a filter and reload posters
   */
  setFilter(type, value) {
    this.activeFilter = { type, value };
    this.currentPage = 1;
    this.currentSearch = ''; // Clear search when filtering
    this.elements.searchInput.value = '';
    this.updateFilterBar();
    this.updateUrlWithFilter();
    this.loadPosters();
  }

  /**
   * Clear the active filter
   */
  clearFilter() {
    this.activeFilter = null;
    this.currentPage = 1;
    this.updateFilterBar();
    this.updateUrlWithFilter();
    this.loadPosters();
  }

  /**
   * Mark browse data as stale (called by other tabs after data changes)
   */
  markBrowseStale() {
    this.browseStale = true;
  }

  /**
   * Update the filter bar UI to reflect current state
   */
  updateFilterBar() {
    if (this.activeFilter) {
      this.elements.filterBar.classList.remove('hidden');

      // Human-friendly type labels
      const typeLabels = {
        artist: 'Artist',
        venue: 'Venue',
        posterType: 'Type'
      };

      this.elements.filterTypeLabel.textContent = typeLabels[this.activeFilter.type] || this.activeFilter.type;
      this.elements.filterValueLabel.textContent = this.activeFilter.value;
    } else {
      this.elements.filterBar.classList.add('hidden');
    }
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
   * Bind tab switching events
   */
  bindTabEvents() {
    this.elements.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      });
    });
  }

  /**
   * Switch between tabs
   */
  async switchTab(tab) {
    if (tab === this.currentTab) return;

    // Update tab button states
    this.elements.tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Hide all tab content
    this.elements.browseTab?.classList.add('hidden');
    this.elements.processingTab?.classList.add('hidden');
    this.elements.databaseTab?.classList.add('hidden');
    this.elements.qaValidationTab?.classList.add('hidden');

    // Show selected tab content
    if (tab === 'browse') {
      this.elements.browseTab?.classList.remove('hidden');
      if (this.browseStale) {
        this.browseStale = false;
        this.loadPosters();
      }
    } else if (tab === 'processing') {
      this.elements.processingTab?.classList.remove('hidden');

      // Initialize processing manager on first visit
      if (!this.processingInitialized) {
        await processingManager.init();
        this.processingInitialized = true;
      }
    } else if (tab === 'database') {
      this.elements.databaseTab?.classList.remove('hidden');

      // Initialize database functionality on first visit
      if (!this.databaseInitialized) {
        await processingManager.init(); // Processing manager handles database operations
        this.databaseInitialized = true;
      }
      // Always refresh stats when opening database tab
      processingManager.loadDatabaseStats();
      processingManager.checkMigrationStatus();
    } else if (tab === 'qa-validation') {
      this.elements.qaValidationTab?.classList.remove('hidden');

      // Initialize QA validation manager on first visit
      if (!this.qaValidationInitialized) {
        await qaValidationManager.init();
        this.qaValidationInitialized = true;
      }
    }

    this.currentTab = tab;
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

      // Determine search query - either from search input or active filter
      const searchQuery = this.currentSearch || (this.activeFilter ? this.activeFilter.value : '');

      if (searchQuery) {
        // Use search endpoint for both search and filter
        result = await this.api.searchPosters(searchQuery, {
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

        // If filtering, apply client-side filtering for more precise results
        if (this.activeFilter && !this.currentSearch) {
          this.posters = this.applyClientFilter(this.posters);
          this.totalPosters = this.posters.length;
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
   * Apply client-side filter to narrow down search results
   */
  applyClientFilter(posters) {
    if (!this.activeFilter) return posters;

    const { type, value } = this.activeFilter;
    const lowerValue = value.toLowerCase();

    return posters.filter(poster => {
      switch (type) {
        case 'artist': {
          // Check headliner and supporting acts
          const parsed = this.parseObservations(poster);
          const headliner = (poster.headliner || parsed.headliner || '').toLowerCase();
          const supporting = poster.supporting_acts || [];
          const supportingStr = (parsed.supporting_acts || '').toLowerCase();

          if (headliner.includes(lowerValue)) return true;
          if (supporting.some(s => s.toLowerCase().includes(lowerValue))) return true;
          if (supportingStr.includes(lowerValue)) return true;
          return false;
        }

        case 'venue': {
          const venueName = this.getVenueName(poster)?.toLowerCase() || '';
          return venueName.includes(lowerValue);
        }

        case 'posterType': {
          const posterType = this.getPosterType(poster)?.toLowerCase() || '';
          return posterType === lowerValue;
        }

        default:
          return true;
      }
    });
  }

  /**
   * Extract image hash from poster name or metadata
   */
  getImageHash(poster) {
    // First try metadata
    if (poster.metadata?.source_image_hash) {
      return poster.metadata.source_image_hash;
    }
    // Extract from poster name (format: poster_HASH or poster_HASH-filename)
    const match = poster.name?.match(/^poster_([a-f0-9]{16})/i);
    return match ? match[1] : null;
  }

  /**
   * Parse observations array to extract structured data
   * Observations are in format "Field: value" or "Field name: value text"
   */
  parseObservations(poster) {
    const observations = poster.observations || [];
    const parsed = {};

    for (const obs of observations) {
      // Match patterns like "Poster type: film" or "Title: Something"
      const match = obs.match(/^([^:]+):\s*(.+)$/i);
      if (match) {
        const key = match[1].toLowerCase().trim().replace(/\s+/g, '_');
        const value = match[2].trim();
        parsed[key] = value;
      }
    }

    return parsed;
  }

  /**
   * Get poster type from HAS_TYPE relationships only.
   * No fallbacks - if typeRelationships is missing, returns null to surface the issue.
   */
  getPosterType(poster) {
    const typeRelation = this.getPrimaryTypeRelation(poster);
    if (typeRelation?.typeKey) {
      return typeRelation.typeKey;
    }
    // No fallbacks - return null to make missing data visible
    return null;
  }

  /**
   * Get the primary type relation from HAS_TYPE relationships
   */
  getPrimaryTypeRelation(poster) {
    const typeRelations = poster.typeRelationships || poster.type_relationships || [];

    // Find primary type, or first type if no primary set
    const primary = typeRelations.find(r => r.isPrimary || r.is_primary);
    if (primary) {
      return {
        typeKey: primary.typeKey || primary.type_key,
        confidence: primary.confidence || 1.0,
        source: primary.source || 'unknown',
        isPrimary: true
      };
    }

    if (typeRelations.length > 0) {
      const first = typeRelations[0];
      return {
        typeKey: first.typeKey || first.type_key,
        confidence: first.confidence || 1.0,
        source: first.source || 'unknown',
        isPrimary: false
      };
    }

    return null;
  }

  /**
   * Get all type relations for a poster
   */
  getAllTypeRelations(poster) {
    return (poster.typeRelationships || poster.type_relationships || []).map(r => ({
      typeKey: r.typeKey || r.type_key,
      confidence: r.confidence || 1.0,
      source: r.source || 'unknown',
      isPrimary: r.isPrimary || r.is_primary || false
    }));
  }

  /**
   * Get poster title from various sources
   */
  getPosterTitle(poster) {
    // Direct field
    if (poster.title) return poster.title;
    if (poster.metadata?.title) return poster.metadata.title;

    // Parse from observations
    const parsed = this.parseObservations(poster);
    if (parsed.title) return parsed.title;

    // Check headliner for concert posters (not film)
    const posterType = this.getPosterType(poster);
    if (posterType !== 'film') {
      if (parsed.headliner && !parsed.headliner.toLowerCase().includes('none') && !parsed.headliner.toLowerCase().includes('not specified') && !parsed.headliner.toLowerCase().includes('not applicable')) {
        return parsed.headliner;
      }
    }

    return null;
  }

  /**
   * Get event date from various sources
   */
  getEventDate(poster) {
    if (poster.event_date) return poster.event_date;
    if (poster.date) return poster.date;
    if (poster.metadata?.event_date) return poster.metadata.event_date;

    const parsed = this.parseObservations(poster);
    if (parsed.event_date) return parsed.event_date;

    return null;
  }

  /**
   * Get venue name from various sources
   */
  getVenueName(poster) {
    if (poster.venue_name) return poster.venue_name;
    if (poster.metadata?.venue_name) return poster.metadata.venue_name;

    const parsed = this.parseObservations(poster);
    if (parsed.venue && !parsed.venue.toLowerCase().includes('not shown') && !parsed.venue.toLowerCase().includes('not visible')) {
      return parsed.venue;
    }

    return null;
  }

  /**
   * Load presigned URLs for poster images
   */
  async loadImageUrls() {
    // Collect hashes that we don't have URLs for yet
    const hashes = [];
    for (const poster of this.posters) {
      const hash = this.getImageHash(poster);
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
      const hash = this.getImageHash(poster);
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

    // Add click handlers for entity links (artist, venue, type)
    this.elements.posterTbody.querySelectorAll('.entity-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const type = link.dataset.type;
        const value = link.dataset.value;
        if (type && value) {
          this.setFilter(type, value);
        }
      });
    });
  }

  /**
   * Render a single table row
   */
  renderTableRow(poster, index) {
    const posterType = this.getPosterType(poster);
    const createdAt = poster.createdAt ? new Date(poster.createdAt).toLocaleDateString() : '-';
    const eventDate = this.getEventDate(poster) || '-';
    const venueName = this.getVenueName(poster) || '-';
    const hash = this.getImageHash(poster);

    // Get descriptive title (from extracted metadata or fallback)
    const displayInfo = this.getDisplayInfo(poster, posterType);

    // Thumbnail: show loading state, actual image loaded async
    let thumbnailHtml;
    if (hash && this.imageUrls[hash]) {
      thumbnailHtml = `
        <div class="thumbnail-wrapper" data-hash="${this.escapeHtml(hash)}">
          <img src="${this.escapeHtml(this.imageUrls[hash])}" alt="${this.escapeHtml(displayInfo.title)}" loading="lazy">
        </div>`;
    } else if (hash) {
      thumbnailHtml = `
        <div class="thumbnail-loading" data-hash="${this.escapeHtml(hash)}">
          <div class="mini-spinner"></div>
        </div>`;
    } else {
      thumbnailHtml = `<div class="thumbnail-placeholder">🎨</div>`;
    }

    // Name cell with descriptive title and hash ID
    const nameHtml = `
      <div class="poster-name-cell">
        <span class="poster-title">${this.escapeHtml(displayInfo.title)}</span>
        ${hash ? `<span class="poster-id">${this.escapeHtml(hash)}</span>` : ''}
      </div>
    `;

    // Make type badge clickable
    const typeBadgeHtml = posterType
      ? `<a href="#" class="entity-link type-link type-badge ${posterType}" data-type="posterType" data-value="${this.escapeHtml(posterType)}">${this.escapeHtml(posterType)}</a>`
      : `<span class="type-badge missing">MISSING TYPE</span>`;

    // Make venue clickable if present
    const venueHtml = venueName !== '-'
      ? `<a href="#" class="entity-link venue-link" data-type="venue" data-value="${this.escapeHtml(venueName)}">${this.escapeHtml(venueName)}</a>`
      : '-';

    return `
      <tr data-index="${index}">
        <td class="td-thumbnail">${thumbnailHtml}</td>
        <td class="td-name">${nameHtml}</td>
        <td>${typeBadgeHtml}</td>
        <td class="artists-cell">${displayInfo.peopleHtml}</td>
        <td class="venue-cell">${venueHtml}</td>
        <td>${this.escapeHtml(eventDate)}</td>
        <td>${createdAt}</td>
      </tr>
    `;
  }

  /**
   * Get display info based on poster type
   * Returns appropriate title and people/artists based on poster type
   */
  getDisplayInfo(poster, posterType) {
    let title = '';
    let peopleHtml = '-';

    // Get title from parsed observations or metadata
    const parsedTitle = this.getPosterTitle(poster);
    if (parsedTitle) {
      title = parsedTitle;
    } else {
      // Fallback to formatted name
      title = this.formatPosterName(poster.name || 'Untitled');
    }

    // Build people/artists based on poster type
    switch ((posterType || 'unknown').toLowerCase()) {
      case 'film':
      case 'movie':
        // Film posters show director/cast instead of artists
        peopleHtml = this.renderFilmPeople(poster);
        break;

      case 'exhibition':
      case 'art':
        // Exhibition posters show artist name
        peopleHtml = this.renderExhibitionPeople(poster);
        break;

      case 'event':
      case 'concert':
      case 'music':
      default:
        // Concert/event posters show headliner + supporting acts
        peopleHtml = this.renderArtists(poster);
        break;
    }

    return { title, peopleHtml };
  }

  /**
   * Render people column for film posters (director/cast) with clickable links
   */
  renderFilmPeople(poster) {
    const metadata = poster.metadata || {};
    const parts = [];

    if (metadata.director) {
      parts.push(`<span class="director-label">Dir:</span> <a href="#" class="entity-link artist-link headliner" data-type="artist" data-value="${this.escapeHtml(metadata.director)}">${this.escapeHtml(metadata.director)}</a>`);
    }

    const cast = metadata.cast || metadata.starring || [];
    if (cast.length > 0) {
      const displayCast = cast.slice(0, 3);
      const castLinks = displayCast.map(c =>
        `<a href="#" class="entity-link artist-link supporting" data-type="artist" data-value="${this.escapeHtml(c)}">${this.escapeHtml(c)}</a>`
      ).join(', ');
      parts.push(`<span class="supporting-group">${castLinks}</span>`);
      if (cast.length > 3) {
        parts.push(`<span class="more-artists">+${cast.length - 3} more</span>`);
      }
    }

    return parts.length > 0 ? parts.join('<br>') : '-';
  }

  /**
   * Render people column for exhibition posters (artist) with clickable links
   */
  renderExhibitionPeople(poster) {
    const metadata = poster.metadata || {};
    const parts = [];

    if (metadata.artist || metadata.exhibiting_artist) {
      const artistName = metadata.artist || metadata.exhibiting_artist;
      parts.push(`<a href="#" class="entity-link artist-link headliner" data-type="artist" data-value="${this.escapeHtml(artistName)}">${this.escapeHtml(artistName)}</a>`);
    }

    if (metadata.curator) {
      parts.push(`<span class="curator-label">Curator:</span> <a href="#" class="entity-link artist-link supporting" data-type="artist" data-value="${this.escapeHtml(metadata.curator)}">${this.escapeHtml(metadata.curator)}</a>`);
    }

    return parts.length > 0 ? parts.join('<br>') : '-';
  }

  /**
   * Render artists column content with clickable links.
   * Prefers enriched artistRelationships data (from graph) over flat fields.
   */
  renderArtists(poster) {
    // Use enriched artist relationship data if available
    const artistRels = poster.artistRelationships;
    if (artistRels && artistRels.length > 0) {
      return this.renderArtistsFromRelationships(artistRels);
    }

    // Fallback to flat fields / observations
    const parsed = this.parseObservations(poster);
    const parts = [];

    // Get headliner from direct field or observations
    let headliner = poster.headliner;
    if (!headliner && parsed.headliner) {
      const h = parsed.headliner;
      // Filter out "none" or "not specified" values
      if (!h.toLowerCase().includes('none') && !h.toLowerCase().includes('not specified') && !h.toLowerCase().includes('not applicable')) {
        headliner = h;
      }
    }

    if (headliner) {
      parts.push(`<a href="#" class="entity-link artist-link headliner" data-type="artist" data-value="${this.escapeHtml(headliner)}">${this.escapeHtml(headliner)}</a>`);
    }

    // Get supporting acts
    let supporting = poster.supporting_acts || [];
    if (supporting.length === 0 && parsed.supporting_acts) {
      const s = parsed.supporting_acts;
      if (!s.toLowerCase().includes('none') && !s.toLowerCase().includes('not specified') && !s.toLowerCase().includes('not applicable')) {
        // Try to split by comma
        supporting = s.split(',').map(a => a.trim()).filter(a => a);
      }
    }

    if (supporting.length > 0) {
      const displaySupporting = supporting.slice(0, 2);
      const supportingLinks = displaySupporting.map(artist =>
        `<a href="#" class="entity-link artist-link supporting" data-type="artist" data-value="${this.escapeHtml(artist)}">${this.escapeHtml(artist)}</a>`
      ).join(', ');
      parts.push(`<span class="supporting-group">${supportingLinks}</span>`);

      if (supporting.length > 2) {
        parts.push(`<span class="more-artists">+${supporting.length - 2} more</span>`);
      }
    }

    return parts.length > 0 ? parts.join('<br>') : '-';
  }

  /**
   * Render artists from enriched graph relationship data.
   * Each artist is an individual clickable entity link.
   */
  renderArtistsFromRelationships(artistRels) {
    const headliners = artistRels.filter(r => r.relationType === 'HEADLINED_ON');
    const supporting = artistRels.filter(r => r.relationType === 'PERFORMED_ON');
    const parts = [];

    for (const rel of headliners) {
      parts.push(`<a href="#" class="entity-link artist-link headliner" data-type="artist" data-value="${this.escapeHtml(rel.displayName)}">${this.escapeHtml(rel.displayName)}</a>`);
    }

    if (supporting.length > 0) {
      const displaySupporting = supporting.slice(0, 3);
      const supportingLinks = displaySupporting.map(rel =>
        `<a href="#" class="entity-link artist-link supporting" data-type="artist" data-value="${this.escapeHtml(rel.displayName)}">${this.escapeHtml(rel.displayName)}</a>`
      ).join(', ');
      parts.push(`<span class="supporting-group">${supportingLinks}</span>`);

      if (supporting.length > 3) {
        parts.push(`<span class="more-artists">+${supporting.length - 3} more</span>`);
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
    const hash = this.getImageHash(poster);
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
    const posterType = this.getPosterType(poster);
    const observations = poster.observations || [];
    const createdAt = poster.createdAt ? new Date(poster.createdAt).toLocaleString() : 'Unknown';
    const id = poster.id || 'N/A';
    const visualElements = poster.visual_elements || {};
    const hash = this.getImageHash(poster);
    const imageUrl = hash ? this.imageUrls[hash] : null;

    // Group relations by type
    const headliners = relations.filter(r => r.relationType === 'HEADLINED_ON');
    const performers = relations.filter(r => r.relationType === 'PERFORMED_ON' || r.relationType === 'FEATURES_ARTIST');
    const venues = relations.filter(r => r.relationType === 'ADVERTISES_VENUE');
    const events = relations.filter(r => r.relationType === 'ADVERTISES_EVENT');
    const typeRelations = relations.filter(r => r.relationType === 'HAS_TYPE');
    const otherRelations = relations.filter(r =>
      !['HEADLINED_ON', 'PERFORMED_ON', 'FEATURES_ARTIST', 'ADVERTISES_VENUE', 'ADVERTISES_EVENT', 'HAS_TYPE'].includes(r.relationType)
    );

    // Build type badge with confidence - no fallbacks
    const typeRelation = this.getPrimaryTypeRelation(poster);
    const allTypes = this.getAllTypeRelations(poster);
    let typeBadgeHtml;
    if (posterType) {
      typeBadgeHtml = `<span class="type-badge ${posterType}">${this.escapeHtml(posterType)}</span>`;
      if (typeRelation?.confidence && typeRelation.confidence < 1.0) {
        const confidencePercent = Math.round(typeRelation.confidence * 100);
        typeBadgeHtml += ` <span class="confidence-badge" title="Confidence: ${confidencePercent}% (${typeRelation.source})">${confidencePercent}%</span>`;
      }
      // Show additional types if poster has multiple
      if (allTypes.length > 1) {
        const secondaryTypes = allTypes.filter(t => !t.isPrimary);
        for (const t of secondaryTypes) {
          const conf = Math.round(t.confidence * 100);
          typeBadgeHtml += ` <span class="type-badge secondary ${t.typeKey}" title="Secondary type: ${conf}% confidence">${this.escapeHtml(t.typeKey)}</span>`;
        }
      }
    } else {
      typeBadgeHtml = `<span class="type-badge missing">MISSING TYPE - No HAS_TYPE relationship found</span>`;
    }

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
        <span style="margin-left: 8px;">${typeBadgeHtml}</span>
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
