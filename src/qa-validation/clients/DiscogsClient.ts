/**
 * Discogs API Client
 *
 * Client for the Discogs music database API.
 * Requires personal access token for higher rate limits.
 *
 * Rate limit: 60 requests/minute (authenticated), 25/minute (unauthenticated)
 * Documentation: https://www.discogs.com/developers
 */

import { BaseAPIClient, APIError } from './BaseAPIClient.js';
import { DiscogsArtist, DiscogsRelease, DiscogsLabel, APIClientConfig } from '../types.js';

const DEFAULT_USER_AGENT = 'PosterMemento-QA/1.0.0';

/**
 * Discogs API response types
 */
interface DiscogsSearchResponse {
  pagination: {
    page: number;
    pages: number;
    per_page: number;
    items: number;
  };
  results: Array<{
    id: number;
    type: 'artist' | 'release' | 'master' | 'label';
    title: string;
    thumb: string;
    cover_image: string;
    resource_url: string;
    uri: string;
    // Additional fields for releases
    year?: string;
    format?: string[];
    label?: string[];
    genre?: string[];
    style?: string[];
    country?: string;
  }>;
}

interface DiscogsArtistResponse {
  id: number;
  name: string;
  realname?: string;
  profile?: string;
  data_quality: string;
  namevariations?: string[];
  aliases?: Array<{ id: number; name: string; resource_url: string }>;
  members?: Array<{ id: number; name: string; resource_url: string; active: boolean }>;
  urls?: string[];
  images?: Array<{ type: string; uri: string; width: number; height: number }>;
  resource_url: string;
  uri: string;
  releases_url: string;
}

interface DiscogsReleaseResponse {
  id: number;
  title: string;
  artists: Array<{ id: number; name: string; resource_url: string }>;
  artists_sort: string;
  data_quality: string;
  thumb: string;
  community: { status: string };
  year?: number;
  labels?: Array<{ id: number; name: string; resource_url: string }>;
  genres?: string[];
  styles?: string[];
  country?: string;
  released?: string;
  tracklist?: Array<{ position: string; title: string; duration: string }>;
  resource_url: string;
  uri: string;
}

interface DiscogsLabelResponse {
  id: number;
  name: string;
  profile?: string;
  data_quality: string;
  contact_info?: string;
  sublabels?: Array<{ id: number; name: string; resource_url: string }>;
  parent_label?: { id: number; name: string; resource_url: string };
  urls?: string[];
  images?: Array<{ type: string; uri: string }>;
  resource_url: string;
  uri: string;
  releases_url: string;
}

/**
 * Default configuration for Discogs API
 */
export function createDiscogsConfig(token?: string, userAgent?: string): APIClientConfig {
  return {
    baseUrl: 'https://api.discogs.com',
    userAgent: userAgent ?? DEFAULT_USER_AGENT,
    rateLimit: {
      maxRequests: token ? 60 : 25, // Higher limit with auth
      windowMs: 60 * 1000, // 1 minute window
    },
    timeout: 10000,
    apiKey: token,
    cacheTTL: 60 * 60 * 1000, // 1 hour cache
  };
}

/**
 * Discogs API client for artist, release, and label lookups
 */
export class DiscogsClient extends BaseAPIClient {
  readonly name = 'discogs';
  private token?: string;

  constructor(token?: string, config?: Partial<APIClientConfig>) {
    const defaultConfig = createDiscogsConfig(token, config?.userAgent);
    super({ ...defaultConfig, ...config });
    this.token = token;
  }

  /**
   * Build headers with authentication if token is available
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Discogs token=${this.token}`;
    }
    return headers;
  }

  /**
   * Search for artists by name
   */
  async searchArtist(name: string, limit: number = 5): Promise<DiscogsArtist[]> {
    const response = await this.request<DiscogsSearchResponse>('/database/search', {
      params: {
        q: name,
        type: 'artist',
        per_page: limit,
      },
      headers: this.getAuthHeaders(),
    });

    return response.results
      .filter(r => r.type === 'artist')
      .map(artist => ({
        id: artist.id,
        title: artist.title,
        thumb: artist.thumb,
        coverImage: artist.cover_image,
        resourceUrl: artist.resource_url,
      }));
  }

  /**
   * Get artist details by ID
   */
  async getArtist(id: number): Promise<DiscogsArtistResponse | null> {
    try {
      return await this.request<DiscogsArtistResponse>(`/artists/${id}`, {
        headers: this.getAuthHeaders(),
      });
    } catch (error) {
      if (error instanceof APIError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Search for releases by title and optionally artist
   */
  async searchRelease(title: string, artist?: string, limit: number = 5): Promise<DiscogsRelease[]> {
    const query = artist ? `${artist} - ${title}` : title;

    const response = await this.request<DiscogsSearchResponse>('/database/search', {
      params: {
        q: query,
        type: 'release',
        per_page: limit,
      },
      headers: this.getAuthHeaders(),
    });

    return response.results
      .filter(r => r.type === 'release')
      .map(release => ({
        id: release.id,
        title: release.title,
        year: release.year,
        format: release.format,
        label: release.label,
        genre: release.genre,
        style: release.style,
        thumb: release.thumb,
        resourceUrl: release.resource_url,
      }));
  }

  /**
   * Get release details by ID
   */
  async getRelease(id: number): Promise<DiscogsReleaseResponse | null> {
    try {
      return await this.request<DiscogsReleaseResponse>(`/releases/${id}`, {
        headers: this.getAuthHeaders(),
      });
    } catch (error) {
      if (error instanceof APIError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Search for master releases (original release grouping)
   */
  async searchMasterRelease(title: string, artist?: string, limit: number = 5): Promise<DiscogsRelease[]> {
    const query = artist ? `${artist} - ${title}` : title;

    const response = await this.request<DiscogsSearchResponse>('/database/search', {
      params: {
        q: query,
        type: 'master',
        per_page: limit,
      },
      headers: this.getAuthHeaders(),
    });

    return response.results
      .filter(r => r.type === 'master')
      .map(release => ({
        id: release.id,
        title: release.title,
        year: release.year,
        format: release.format,
        label: release.label,
        genre: release.genre,
        style: release.style,
        thumb: release.thumb,
        resourceUrl: release.resource_url,
      }));
  }

  /**
   * Search for labels by name
   */
  async searchLabel(name: string, limit: number = 5): Promise<DiscogsLabel[]> {
    const response = await this.request<DiscogsSearchResponse>('/database/search', {
      params: {
        q: name,
        type: 'label',
        per_page: limit,
      },
      headers: this.getAuthHeaders(),
    });

    return response.results
      .filter(r => r.type === 'label')
      .map(label => ({
        id: label.id,
        title: label.title,
        resourceUrl: label.resource_url,
      }));
  }

  /**
   * Get label details by ID
   */
  async getLabel(id: number): Promise<DiscogsLabelResponse | null> {
    try {
      return await this.request<DiscogsLabelResponse>(`/labels/${id}`, {
        headers: this.getAuthHeaders(),
      });
    } catch (error) {
      if (error instanceof APIError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Check if Discogs API is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Search for a well-known artist
      await this.request<DiscogsSearchResponse>('/database/search', {
        params: {
          q: 'The Beatles',
          type: 'artist',
          per_page: 1,
        },
        headers: this.getAuthHeaders(),
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get URL for an artist on Discogs website
   */
  getArtistUrl(id: number): string {
    return `https://www.discogs.com/artist/${id}`;
  }

  /**
   * Get URL for a release on Discogs website
   */
  getReleaseUrl(id: number): string {
    return `https://www.discogs.com/release/${id}`;
  }

  /**
   * Get URL for a label on Discogs website
   */
  getLabelUrl(id: number): string {
    return `https://www.discogs.com/label/${id}`;
  }

  /**
   * Check if client has authentication token
   */
  isAuthenticated(): boolean {
    return !!this.token;
  }
}
