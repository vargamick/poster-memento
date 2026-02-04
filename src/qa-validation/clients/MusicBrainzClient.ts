/**
 * MusicBrainz API Client
 *
 * Client for the MusicBrainz music database API.
 * Free to use, no API key required, but requires proper User-Agent.
 *
 * Rate limit: 1 request per second
 * Documentation: https://musicbrainz.org/doc/MusicBrainz_API
 */

import { BaseAPIClient, APIError } from './BaseAPIClient.js';
import { MusicBrainzArtist, MusicBrainzRelease, APIClientConfig } from '../types.js';

const DEFAULT_USER_AGENT = 'PosterMemento-QA/1.0.0 (https://github.com/GregRako/PastedandWasted)';

/**
 * MusicBrainz API response types
 */
interface MBArtistSearchResponse {
  created: string;
  count: number;
  offset: number;
  artists: Array<{
    id: string;
    name: string;
    'sort-name': string;
    disambiguation?: string;
    type?: string;
    country?: string;
    area?: { name: string };
    score: number;
    tags?: Array<{ name: string; count: number }>;
  }>;
}

interface MBReleaseSearchResponse {
  created: string;
  count: number;
  offset: number;
  releases: Array<{
    id: string;
    title: string;
    'artist-credit': Array<{
      artist: { id: string; name: string };
      joinphrase?: string;
    }>;
    'release-group'?: {
      id: string;
      'primary-type'?: string;
    };
    date?: string;
    country?: string;
    'label-info'?: Array<{
      label?: { id: string; name: string };
    }>;
    score: number;
  }>;
}

interface MBLabelSearchResponse {
  created: string;
  count: number;
  offset: number;
  labels: Array<{
    id: string;
    name: string;
    'sort-name': string;
    disambiguation?: string;
    type?: string;
    country?: string;
    score: number;
  }>;
}

interface MBEventSearchResponse {
  created: string;
  count: number;
  offset: number;
  events: Array<{
    id: string;
    name: string;
    disambiguation?: string;
    type?: string;
    'life-span'?: {
      begin?: string;
      end?: string;
    };
    score: number;
  }>;
}

/**
 * Default configuration for MusicBrainz API
 */
export function createMusicBrainzConfig(userAgent?: string): APIClientConfig {
  return {
    baseUrl: 'https://musicbrainz.org/ws/2',
    userAgent: userAgent ?? DEFAULT_USER_AGENT,
    rateLimit: {
      maxRequests: 1,
      windowMs: 1100, // Slightly over 1 second to be safe
    },
    timeout: 10000,
    cacheTTL: 60 * 60 * 1000, // 1 hour cache
  };
}

/**
 * MusicBrainz API client for artist, release, and label lookups
 */
export class MusicBrainzClient extends BaseAPIClient {
  readonly name = 'musicbrainz';

  constructor(config?: Partial<APIClientConfig>) {
    const defaultConfig = createMusicBrainzConfig(config?.userAgent);
    super({ ...defaultConfig, ...config });
  }

  /**
   * Search for artists by name
   */
  async searchArtist(name: string, limit: number = 5): Promise<MusicBrainzArtist[]> {
    const response = await this.request<MBArtistSearchResponse>('/artist', {
      params: {
        query: `artist:"${this.escapeQuery(name)}"`,
        fmt: 'json',
        limit,
      },
    });

    return response.artists.map(artist => ({
      id: artist.id,
      name: artist.name,
      sortName: artist['sort-name'],
      disambiguation: artist.disambiguation,
      type: artist.type,
      country: artist.country,
      area: artist.area?.name,
      score: artist.score,
      tags: artist.tags,
    }));
  }

  /**
   * Search for artists with fuzzy matching
   */
  async searchArtistFuzzy(name: string, limit: number = 10): Promise<MusicBrainzArtist[]> {
    // Use fuzzy search without quotes for broader matching
    const response = await this.request<MBArtistSearchResponse>('/artist', {
      params: {
        query: this.escapeQuery(name),
        fmt: 'json',
        limit,
      },
    });

    return response.artists.map(artist => ({
      id: artist.id,
      name: artist.name,
      sortName: artist['sort-name'],
      disambiguation: artist.disambiguation,
      type: artist.type,
      country: artist.country,
      area: artist.area?.name,
      score: artist.score,
      tags: artist.tags,
    }));
  }

  /**
   * Get artist by MBID
   */
  async getArtist(mbid: string): Promise<MusicBrainzArtist | null> {
    try {
      const response = await this.request<{
        id: string;
        name: string;
        'sort-name': string;
        disambiguation?: string;
        type?: string;
        country?: string;
        area?: { name: string };
        tags?: Array<{ name: string; count: number }>;
      }>(`/artist/${mbid}`, {
        params: { fmt: 'json' },
      });

      return {
        id: response.id,
        name: response.name,
        sortName: response['sort-name'],
        disambiguation: response.disambiguation,
        type: response.type,
        country: response.country,
        area: response.area?.name,
        score: 100, // Direct lookup, perfect score
        tags: response.tags,
      };
    } catch (error) {
      if (error instanceof APIError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Search for releases (albums) by title
   */
  async searchRelease(title: string, artist?: string, limit: number = 5): Promise<MusicBrainzRelease[]> {
    let query = `release:"${this.escapeQuery(title)}"`;
    if (artist) {
      query += ` AND artist:"${this.escapeQuery(artist)}"`;
    }

    const response = await this.request<MBReleaseSearchResponse>('/release', {
      params: {
        query,
        fmt: 'json',
        limit,
      },
    });

    return response.releases.map(release => ({
      id: release.id,
      title: release.title,
      artistCredit: release['artist-credit']
        .map(ac => ac.artist.name + (ac.joinphrase || ''))
        .join(''),
      releaseGroup: release['release-group']
        ? {
            id: release['release-group'].id,
            primaryType: release['release-group']['primary-type'],
          }
        : undefined,
      date: release.date,
      country: release.country,
      labelInfo: release['label-info']?.map(li => ({
        label: li.label ? { id: li.label.id, name: li.label.name } : undefined,
      })),
      score: release.score,
    }));
  }

  /**
   * Search for labels by name
   */
  async searchLabel(name: string, limit: number = 5): Promise<Array<{
    id: string;
    name: string;
    sortName: string;
    disambiguation?: string;
    type?: string;
    country?: string;
    score: number;
  }>> {
    const response = await this.request<MBLabelSearchResponse>('/label', {
      params: {
        query: `label:"${this.escapeQuery(name)}"`,
        fmt: 'json',
        limit,
      },
    });

    return response.labels.map(label => ({
      id: label.id,
      name: label.name,
      sortName: label['sort-name'],
      disambiguation: label.disambiguation,
      type: label.type,
      country: label.country,
      score: label.score,
    }));
  }

  /**
   * Search for events
   */
  async searchEvent(name: string, limit: number = 5): Promise<Array<{
    id: string;
    name: string;
    disambiguation?: string;
    type?: string;
    beginDate?: string;
    endDate?: string;
    score: number;
  }>> {
    const response = await this.request<MBEventSearchResponse>('/event', {
      params: {
        query: `event:"${this.escapeQuery(name)}"`,
        fmt: 'json',
        limit,
      },
    });

    return response.events.map(event => ({
      id: event.id,
      name: event.name,
      disambiguation: event.disambiguation,
      type: event.type,
      beginDate: event['life-span']?.begin,
      endDate: event['life-span']?.end,
      score: event.score,
    }));
  }

  /**
   * Escape special characters in search queries
   */
  private escapeQuery(query: string): string {
    // Escape Lucene special characters
    return query.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
  }

  /**
   * Check if MusicBrainz API is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simple search to check connectivity
      await this.request<MBArtistSearchResponse>('/artist', {
        params: {
          query: 'artist:"The Beatles"',
          fmt: 'json',
          limit: 1,
        },
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get URL for an artist on MusicBrainz website
   */
  getArtistUrl(mbid: string): string {
    return `https://musicbrainz.org/artist/${mbid}`;
  }

  /**
   * Get URL for a release on MusicBrainz website
   */
  getReleaseUrl(mbid: string): string {
    return `https://musicbrainz.org/release/${mbid}`;
  }

  /**
   * Get URL for a label on MusicBrainz website
   */
  getLabelUrl(mbid: string): string {
    return `https://musicbrainz.org/label/${mbid}`;
  }
}
