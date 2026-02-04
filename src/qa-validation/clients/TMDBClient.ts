/**
 * TMDB (The Movie Database) API Client
 *
 * Client for TMDB API to validate film poster metadata.
 * Requires API key (free registration).
 *
 * Rate limit: 50 requests/second
 * Documentation: https://developer.themoviedb.org/reference/intro/getting-started
 */

import { BaseAPIClient, APIError } from './BaseAPIClient.js';
import { TMDBMovie, APIClientConfig } from '../types.js';

const DEFAULT_USER_AGENT = 'PosterMemento-QA/1.0.0';

/**
 * TMDB API response types
 */
interface TMDBSearchMovieResponse {
  page: number;
  results: Array<{
    id: number;
    title: string;
    original_title: string;
    release_date: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    popularity: number;
    vote_average: number;
    vote_count: number;
    adult: boolean;
    genre_ids: number[];
    original_language: string;
  }>;
  total_pages: number;
  total_results: number;
}

interface TMDBMovieDetailsResponse {
  id: number;
  title: string;
  original_title: string;
  release_date: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  popularity: number;
  vote_average: number;
  vote_count: number;
  adult: boolean;
  genres: Array<{ id: number; name: string }>;
  production_companies: Array<{
    id: number;
    name: string;
    logo_path: string | null;
    origin_country: string;
  }>;
  production_countries: Array<{ iso_3166_1: string; name: string }>;
  runtime: number | null;
  status: string;
  tagline: string | null;
  budget: number;
  revenue: number;
  imdb_id: string | null;
}

interface TMDBCreditsResponse {
  id: number;
  cast: Array<{
    id: number;
    name: string;
    original_name: string;
    character: string;
    order: number;
    profile_path: string | null;
  }>;
  crew: Array<{
    id: number;
    name: string;
    original_name: string;
    job: string;
    department: string;
    profile_path: string | null;
  }>;
}

interface TMDBSearchPersonResponse {
  page: number;
  results: Array<{
    id: number;
    name: string;
    original_name: string;
    known_for_department: string;
    popularity: number;
    profile_path: string | null;
    known_for: Array<{
      id: number;
      title?: string;
      name?: string;
      media_type: string;
    }>;
  }>;
  total_pages: number;
  total_results: number;
}

/**
 * Default configuration for TMDB API
 */
export function createTMDBConfig(apiKey: string, userAgent?: string): APIClientConfig {
  return {
    baseUrl: 'https://api.themoviedb.org/3',
    userAgent: userAgent ?? DEFAULT_USER_AGENT,
    rateLimit: {
      maxRequests: 40, // Stay under the 50/sec limit
      windowMs: 1000,
    },
    timeout: 10000,
    apiKey,
    cacheTTL: 60 * 60 * 1000, // 1 hour cache
  };
}

/**
 * TMDB API client for film and TV show lookups
 */
export class TMDBClient extends BaseAPIClient {
  readonly name = 'tmdb';
  private tmdbApiKey: string;

  constructor(apiKey: string, config?: Partial<APIClientConfig>) {
    if (!apiKey) {
      throw new Error('TMDB API key is required');
    }
    const defaultConfig = createTMDBConfig(apiKey, config?.userAgent);
    super({ ...defaultConfig, ...config });
    this.tmdbApiKey = apiKey;
  }

  /**
   * Get params with API key
   */
  private withApiKey(params: Record<string, string | number | boolean | undefined> = {}): Record<string, string | number | boolean | undefined> {
    return {
      ...params,
      api_key: this.tmdbApiKey,
    };
  }

  /**
   * Search for movies by title
   */
  async searchMovie(title: string, year?: number, limit: number = 5): Promise<TMDBMovie[]> {
    const response = await this.request<TMDBSearchMovieResponse>('/search/movie', {
      params: this.withApiKey({
        query: title,
        year: year,
        page: 1,
        include_adult: false,
      }),
    });

    return response.results.slice(0, limit).map(movie => ({
      id: movie.id,
      title: movie.title,
      originalTitle: movie.original_title,
      releaseDate: movie.release_date,
      overview: movie.overview,
      posterPath: movie.poster_path,
      popularity: movie.popularity,
      voteAverage: movie.vote_average,
    }));
  }

  /**
   * Get movie details by ID
   */
  async getMovie(id: number): Promise<TMDBMovieDetailsResponse | null> {
    try {
      return await this.request<TMDBMovieDetailsResponse>(`/movie/${id}`, {
        params: this.withApiKey({}),
      });
    } catch (error) {
      if (error instanceof APIError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get movie credits (cast and crew)
   */
  async getMovieCredits(movieId: number): Promise<TMDBCreditsResponse | null> {
    try {
      return await this.request<TMDBCreditsResponse>(`/movie/${movieId}/credits`, {
        params: this.withApiKey({}),
      });
    } catch (error) {
      if (error instanceof APIError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Search for people (actors, directors, etc.)
   */
  async searchPerson(name: string, limit: number = 5): Promise<Array<{
    id: number;
    name: string;
    knownForDepartment: string;
    popularity: number;
    knownFor: Array<{ id: number; title?: string; name?: string; mediaType: string }>;
  }>> {
    const response = await this.request<TMDBSearchPersonResponse>('/search/person', {
      params: this.withApiKey({
        query: name,
        page: 1,
        include_adult: false,
      }),
    });

    return response.results.slice(0, limit).map(person => ({
      id: person.id,
      name: person.name,
      knownForDepartment: person.known_for_department,
      popularity: person.popularity,
      knownFor: person.known_for.map(kf => ({
        id: kf.id,
        title: kf.title,
        name: kf.name,
        mediaType: kf.media_type,
      })),
    }));
  }

  /**
   * Search for TV shows by title
   */
  async searchTVShow(title: string, year?: number, limit: number = 5): Promise<Array<{
    id: number;
    name: string;
    originalName: string;
    firstAirDate: string;
    overview: string;
    posterPath?: string;
    popularity: number;
    voteAverage: number;
  }>> {
    const response = await this.request<{
      results: Array<{
        id: number;
        name: string;
        original_name: string;
        first_air_date: string;
        overview: string;
        poster_path: string | null;
        popularity: number;
        vote_average: number;
      }>;
    }>('/search/tv', {
      params: this.withApiKey({
        query: title,
        first_air_date_year: year,
        page: 1,
        include_adult: false,
      }),
    });

    return response.results.slice(0, limit).map(show => ({
      id: show.id,
      name: show.name,
      originalName: show.original_name,
      firstAirDate: show.first_air_date,
      overview: show.overview,
      posterPath: show.poster_path ?? undefined,
      popularity: show.popularity,
      voteAverage: show.vote_average,
    }));
  }

  /**
   * Check if TMDB API is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simple search to check connectivity
      await this.request<TMDBSearchMovieResponse>('/search/movie', {
        params: this.withApiKey({
          query: 'Star Wars',
          page: 1,
        }),
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get URL for a movie on TMDB website
   */
  getMovieUrl(id: number): string {
    return `https://www.themoviedb.org/movie/${id}`;
  }

  /**
   * Get URL for a person on TMDB website
   */
  getPersonUrl(id: number): string {
    return `https://www.themoviedb.org/person/${id}`;
  }

  /**
   * Get full poster image URL
   */
  getPosterUrl(posterPath: string, size: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w500'): string {
    return `https://image.tmdb.org/t/p/${size}${posterPath}`;
  }

  /**
   * Extract year from a release date string
   */
  static extractYear(releaseDate: string): number | undefined {
    if (!releaseDate) return undefined;
    const match = releaseDate.match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : undefined;
  }
}
