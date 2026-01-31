/**
 * Entity Builder Utility
 *
 * Build entities and relationships from product metadata.
 * Supports both legacy keyword-based extraction and catalog-based
 * synonym-aware extraction.
 *
 * Adapted from scripts/agar-processing/utils/entity-builder.ts
 * for use within the processing service.
 */

import { DilutionRatio, StructuredProductData } from './observation-parser.js';
import type { CatalogLoader, ExtractionResult } from './catalog-loader.js';

/**
 * Product metadata from JSON file (scraper output)
 */
export interface ProductMetadata {
  product_name: string;
  product_url: string;
  product_image_url: string;
  product_overview: string;
  product_description: string;
  product_skus: string;
  product_categories: string[];
  category: string;
  category_slug: string;
  sds_url: string;
  pds_url: string;
  scraped_at: string;
}

/**
 * Equipment type for equipment entities
 */
export interface EquipmentType {
  name: string;
  equipment_name: string;
  category: 'manual' | 'mechanical' | 'powered' | 'dispensing' | 'protective';
}

/**
 * Standard equipment types
 */
export const STANDARD_EQUIPMENT: EquipmentType[] = [
  { name: 'agar_equipment_mop_bucket', equipment_name: 'Mop Bucket', category: 'manual' },
  { name: 'agar_equipment_autoscrubber', equipment_name: 'Autoscrubber', category: 'powered' },
  { name: 'agar_equipment_spray_bottle', equipment_name: 'Spray Bottle', category: 'dispensing' },
  { name: 'agar_equipment_steam_cleaner', equipment_name: 'Steam Cleaner', category: 'powered' },
  { name: 'agar_equipment_pressure_washer', equipment_name: 'Pressure Washer', category: 'powered' },
  { name: 'agar_equipment_extraction_machine', equipment_name: 'Extraction Machine', category: 'powered' },
  { name: 'agar_equipment_buffing_machine', equipment_name: 'Buffing Machine', category: 'powered' },
  { name: 'agar_equipment_microfibre_mop', equipment_name: 'Microfibre Mop', category: 'manual' },
  { name: 'agar_equipment_scrubbing_brush', equipment_name: 'Scrubbing Brush', category: 'manual' },
  { name: 'agar_equipment_ultrasonic_tank', equipment_name: 'Ultrasonic Cleaning Tank', category: 'powered' },
  { name: 'agar_equipment_foam_gun', equipment_name: 'Foam Gun', category: 'dispensing' },
  { name: 'agar_equipment_dispensing_system', equipment_name: 'Dispensing System', category: 'dispensing' },
  { name: 'agar_equipment_trigger_sprayer', equipment_name: 'Trigger Sprayer', category: 'dispensing' }
];

/**
 * Build entities from product metadata
 */
export class EntityBuilder {

  /**
   * Normalize product name to entity ID format
   * Example: "3D-Gloss" -> "agar_product_3dg"
   */
  static normalizeProductName(productName: string): string {
    // Extract product code from name (remove hyphens, take first part)
    const normalized = productName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    return `agar_product_${normalized}`;
  }

  /**
   * Extract product code from SKUs
   * Example: "3DG5, 3DG20" -> "3DG"
   */
  static extractProductCode(skus: string): string {
    if (!skus) return '';

    // Take first SKU and extract letters only
    const firstSku = skus.split(',')[0].trim();
    const code = firstSku.replace(/[0-9]/g, '');

    return code || firstSku;
  }

  /**
   * Build product entity from metadata (v2.1 schema with structured fields)
   */
  static buildProductEntity(metadata: ProductMetadata): Record<string, unknown> {
    const entityId = this.normalizeProductName(metadata.product_name);
    const productCode = this.extractProductCode(metadata.product_skus);

    // Extract technical data from description
    const technical = this.extractTechnicalData(metadata.product_description);

    // Extract safety warnings
    const safetyWarnings = this.extractSafetyWarnings(metadata.product_description);

    // Extract incompatible surfaces
    const incompatibleSurfaces = this.extractIncompatibleSurfaces(metadata.product_description);

    // Extract dilution ratios
    const dilutionRatios = this.extractDilutionRatios(metadata.product_description);

    // Determine if ready to use (no dilution needed)
    const readyToUse = dilutionRatios.length === 0;

    // Extract application methods
    const applicationMethods = this.extractApplicationMethods(metadata.product_description);

    // Extract foam level
    const foamLevel = this.extractFoamLevel(metadata.product_description);

    // Extract equipment
    const suitableEquipment = this.extractEquipment(metadata.product_description);

    // Extract environmental certifications
    const envCerts = this.extractEnvironmentalCertifications(
      metadata.product_overview + ' ' + metadata.product_description
    );

    // Extract key benefits
    const keyBenefits = this.extractKeyBenefits(metadata.product_overview);

    // Check flammability
    const flammable = this.checkFlammability(metadata.product_description);

    // Build entity with structured fields (v2.1 schema)
    const entity: Record<string, unknown> = {
      name: entityId,
      entityType: 'agar_product',

      // Required structured fields (v2.1)
      product_name: metadata.product_name,
      product_code: productCode,
      overview: metadata.product_overview || '',
      description: metadata.product_description || '',
      container_sizes: technical.container_sizes || [],

      // Optional structured fields
      ...(technical.ph !== undefined && { ph: technical.ph }),
      ...(technical.ph_min !== undefined && { ph_min: technical.ph_min }),
      ...(technical.ph_max !== undefined && { ph_max: technical.ph_max }),
      ...(technical.color && { color: technical.color }),
      ...(technical.odor && { odor: technical.odor }),
      ...(technical.appearance && { appearance: technical.appearance }),
      ...(foamLevel && { foam_level: foamLevel }),
      ...(dilutionRatios.length > 0 && { dilution_ratios: dilutionRatios }),
      ...(safetyWarnings.length > 0 && { safety_warnings: safetyWarnings }),
      ...(incompatibleSurfaces.length > 0 && { incompatible_surfaces: incompatibleSurfaces }),
      ...(keyBenefits.length > 0 && { key_benefits: keyBenefits }),
      ...(applicationMethods.length > 0 && { application_methods: applicationMethods }),
      ...(suitableEquipment.length > 0 && { suitable_equipment: suitableEquipment }),
      ...(envCerts.length > 0 && { environmental_certifications: envCerts }),
      flammable,
      ready_to_use: readyToUse,

      // Legacy observations (minimal - for overflow only)
      observations: [],

      // Metadata for document tracking
      metadata: {
        skus: metadata.product_skus,
        categories: metadata.product_categories,
        category: metadata.category,
        category_slug: metadata.category_slug,
        product_url: metadata.product_url,
        image_url: metadata.product_image_url,
        sds_url: metadata.sds_url,
        pds_url: metadata.pds_url,
        pdf_source: metadata.pds_url,
        scraped_at: metadata.scraped_at,
        migration_status: 'complete',
        schema_version: '2.1.0'
      }
    };

    return entity;
  }

  /**
   * Build product entity from legacy observations (for migration)
   */
  static buildProductEntityFromObservations(
    observations: string[],
    productName: string,
    pdfFilename?: string
  ): Record<string, unknown> {
    const entityId = this.normalizeProductName(productName);

    // Parse observations to structured data
    const structured = this.parseObservationsToStructured(observations, productName, pdfFilename);

    return {
      name: entityId,
      entityType: 'agar_product',
      ...structured,
      observations: structured.observations || [],
      metadata: {
        migration_status: 'complete',
        schema_version: '2.1.0',
        migrated_from: 'observations'
      }
    };
  }

  /**
   * Parse observations array to structured fields
   */
  static parseObservationsToStructured(
    observations: string[],
    productName: string,
    pdfFilename?: string
  ): StructuredProductData {
    const result: StructuredProductData = {
      product_name: '',
      product_code: '',
      overview: '',
      description: '',
      container_sizes: [],
      observations: []
    };

    // Extract product name
    result.product_name = this.extractObservationField(observations, 'Product:') || productName;

    // Generate product code
    result.product_code = this.deriveProductCodeFromName(result.product_name, pdfFilename);

    // Extract overview
    const overviewObs = observations.find(o =>
      o.startsWith('Overview:') || o.toLowerCase().includes('what is')
    );
    if (overviewObs) {
      result.overview = overviewObs
        .replace(/^Overview:\s*/i, '')
        .replace(/^What is \w+\??\s*/i, '')
        .trim();
    }

    // Extract description
    const descObs = observations.find(o => o.startsWith('Description:'));
    if (descObs) {
      result.description = descObs
        .replace(/^Description:\s*/i, '')
        .replace(/DescriptionHow Does It Work\?/gi, '')
        .replace(/How Does It Work\?/gi, '')
        .trim();
    }

    // Extract container sizes
    const containerObs = observations.find(o =>
      o.toLowerCase().includes('container size')
    );
    if (containerObs) {
      const match = containerObs.match(/Container Sizes?[:\s]+(.+)$/i);
      if (match) {
        result.container_sizes = match[1]
          .split(',')
          .map(s => s.trim().replace(/\s+/g, '').toUpperCase())
          .filter(s => /^\d+/.test(s));
      }
    }

    // Extract pH
    const phData = this.extractPHFromObservations(observations);
    if (phData.ph !== undefined) result.ph = phData.ph;
    if (phData.ph_min !== undefined) result.ph_min = phData.ph_min;
    if (phData.ph_max !== undefined) result.ph_max = phData.ph_max;

    // Extract color
    const color = this.extractObservationField(observations, 'Color:') ||
                  this.extractObservationField(observations, 'Colour:');
    if (color && !/fastness|^\d+$|^on\s|^and\s/i.test(color)) {
      result.color = color;
    }

    // Extract odor
    result.odor = this.extractObservationField(observations, 'Odor:') ||
                  this.extractObservationField(observations, 'Odour:') ||
                  undefined;

    // Extract safety warnings
    if (result.description) {
      result.safety_warnings = this.extractSafetyWarnings(result.description);
      result.incompatible_surfaces = this.extractIncompatibleSurfaces(result.description);
      result.dilution_ratios = this.extractDilutionRatios(result.description);
      result.application_methods = this.extractApplicationMethods(result.description);
      result.foam_level = this.extractFoamLevel(result.description);
      result.suitable_equipment = this.extractEquipment(result.description);
      result.flammable = this.checkFlammability(result.description);
    }

    result.ready_to_use = !result.dilution_ratios || result.dilution_ratios.length === 0;

    // Extract from overview
    if (result.overview) {
      result.key_benefits = this.extractKeyBenefits(result.overview);
      result.environmental_certifications = this.extractEnvironmentalCertifications(
        result.overview + ' ' + (result.description || '')
      );
    }

    // Collect unprocessed observations
    const processedPrefixes = [
      'Product:', 'Overview:', 'Description:', 'Container Size',
      'Ph:', 'Ph ', 'Color:', 'Colour:', 'Odor:', 'Odour:'
    ];
    result.observations = observations.filter(obs =>
      !processedPrefixes.some(prefix =>
        obs.toLowerCase().startsWith(prefix.toLowerCase())
      )
    );

    return result;
  }

  /**
   * Extract field from observations by prefix
   */
  static extractObservationField(observations: string[], prefix: string): string | null {
    const obs = observations.find(o => o.startsWith(prefix));
    return obs ? obs.substring(prefix.length).trim() : null;
  }

  /**
   * Derive product code from product name
   */
  static deriveProductCodeFromName(productName: string, pdfFilename?: string): string {
    if (pdfFilename) {
      const fileCode = pdfFilename
        .replace(/_PDS\.pdf$/i, '')
        .replace(/_SDS\.pdf$/i, '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase();
      if (fileCode) return fileCode;
    }

    return productName
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .substring(0, 20);
  }

  /**
   * Extract pH from observations
   */
  static extractPHFromObservations(observations: string[]): { ph?: number; ph_min?: number; ph_max?: number } {
    const result: { ph?: number; ph_min?: number; ph_max?: number } = {};

    const phObs = observations.find(o => /^ph\s*[:\s]/i.test(o));
    const phMinObs = observations.find(o => /^ph\s*min/i.test(o));
    const phMaxObs = observations.find(o => /^ph\s*max/i.test(o));

    if (phMinObs) {
      const match = phMinObs.match(/(\d+\.?\d*)/);
      if (match) {
        const val = parseFloat(match[1]);
        if (val >= 0 && val <= 14) result.ph_min = val;
      }
    }

    if (phMaxObs) {
      const match = phMaxObs.match(/(\d+\.?\d*)/);
      if (match) {
        const val = parseFloat(match[1]);
        if (val >= 0 && val <= 14) result.ph_max = val;
      }
    }

    if (phObs && !phMinObs && !phMaxObs) {
      const rangeMatch = phObs.match(/(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)/);
      if (rangeMatch) {
        const min = parseFloat(rangeMatch[1]);
        const max = parseFloat(rangeMatch[2]);
        if (min >= 0 && min <= 14 && max >= 0 && max <= 14) {
          result.ph_min = Math.min(min, max);
          result.ph_max = Math.max(min, max);
        }
      } else {
        const singleMatch = phObs.match(/(\d+\.?\d*)/);
        if (singleMatch) {
          const val = parseFloat(singleMatch[1]);
          if (val >= 0 && val <= 14) result.ph = val;
        }
      }
    }

    if (result.ph_min !== undefined && result.ph_max !== undefined && result.ph === undefined) {
      result.ph = (result.ph_min + result.ph_max) / 2;
    }

    return result;
  }

  /**
   * Extract safety warnings from text
   */
  static extractSafetyWarnings(text: string): string[] {
    const warnings: string[] = [];

    const cautionMatches = text.match(/(?:CAUTION|WARNING)[:\s]+(.+?)(?:\.|$)/gi);
    if (cautionMatches) {
      warnings.push(...cautionMatches.map(m => m.trim()));
    }

    const doNotMatches = text.match(/DO NOT\s+[^.]+\./gi);
    if (doNotMatches) {
      warnings.push(...doNotMatches.map(m => m.trim()));
    }

    return Array.from(new Set(warnings));
  }

  /**
   * Extract incompatible surfaces from text
   */
  static extractIncompatibleSurfaces(text: string): string[] {
    const surfaces: string[] = [];

    const patterns = [
      /DO NOT use (?:on )?([^.]+?)(?:\.|,|$)/gi,
      /NOT suitable for(?: use on)? ([^.]+?)(?:\.|,|$)/gi,
      /Not for use on ([^.]+?)(?:\.|,|$)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const surface = match[1].trim().toLowerCase();
        if (surface && surface.length < 100) {
          surfaces.push(surface);
        }
      }
    }

    return Array.from(new Set(surfaces));
  }

  /**
   * Extract dilution ratios from text
   */
  static extractDilutionRatios(text: string): DilutionRatio[] {
    const ratios: DilutionRatio[] = [];

    const pattern = /(?:dilute\s+)?(\d+:\d+)\s*(?:for|[-–])\s*([^,.]+)/gi;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      ratios.push({
        ratio: match[1],
        use_case: match[2].trim()
      });
    }

    if (ratios.length === 0) {
      const standalonePattern = /(\d+:\d+)/g;
      let standaloneMatch;
      while ((standaloneMatch = standalonePattern.exec(text)) !== null) {
        if (!ratios.some(r => r.ratio === standaloneMatch[1])) {
          ratios.push({
            ratio: standaloneMatch[1],
            use_case: 'general use'
          });
        }
      }
    }

    return ratios;
  }

  /**
   * Extract application methods from text
   */
  static extractApplicationMethods(text: string): string[] {
    const methods: string[] = [];
    const lowerText = text.toLowerCase();

    const methodKeywords: Record<string, string> = {
      'mop': 'mop',
      'spray': 'spray',
      'autoscrubber': 'autoscrubber',
      'scrubber': 'autoscrubber',
      'steam clean': 'steam_cleaner',
      'extraction': 'extraction',
      'wipe': 'hand_wipe',
      'soak': 'soak',
      'brush': 'brush',
      'pour': 'pour',
      'dip': 'dip'
    };

    for (const [keyword, method] of Object.entries(methodKeywords)) {
      if (lowerText.includes(keyword)) {
        methods.push(method);
      }
    }

    return Array.from(new Set(methods));
  }

  /**
   * Extract foam level from text
   */
  static extractFoamLevel(text: string): 'none' | 'low' | 'medium' | 'high' | undefined {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('no foam') || lowerText.includes('non-foaming') ||
        lowerText.includes('foam free')) {
      return 'none';
    }
    if (lowerText.includes('low foam') || lowerText.includes('low-foam')) {
      return 'low';
    }
    if (lowerText.includes('high foam') || lowerText.includes('rich foam')) {
      return 'high';
    }
    if (lowerText.includes('foam')) {
      return 'medium';
    }
    return undefined;
  }

  /**
   * Extract key benefits from overview
   */
  static extractKeyBenefits(overview: string): string[] {
    const benefits: string[] = [];

    const benefitPatterns = [
      /GECA certified/gi,
      /biodegradable/gi,
      /phosphate[- ]?free/gi,
      /eco[- ]?friendly/gi,
      /Australian made/gi,
      /no rinse/gi,
      /quick dry/gi,
      /streak[- ]?free/gi,
      /multipurpose/gi,
      /concentrated/gi,
      /ready to use/gi
    ];

    for (const pattern of benefitPatterns) {
      const match = overview.match(pattern);
      if (match) {
        benefits.push(match[0]);
      }
    }

    return benefits;
  }

  /**
   * Extract environmental certifications
   */
  static extractEnvironmentalCertifications(text: string): string[] {
    const certs: string[] = [];
    const lowerText = text.toLowerCase();

    const certPatterns: Record<string, string> = {
      'geca': 'GECA',
      'green seal': 'Green Seal',
      'biodegradable': 'Biodegradable',
      'phosphate free': 'Phosphate Free',
      'phosphate-free': 'Phosphate Free'
    };

    for (const [pattern, cert] of Object.entries(certPatterns)) {
      if (lowerText.includes(pattern)) {
        certs.push(cert);
      }
    }

    return certs;
  }

  /**
   * Check flammability
   */
  static checkFlammability(text: string): boolean {
    const lowerText = text.toLowerCase();
    return lowerText.includes('flammable') ||
           lowerText.includes('flash point') ||
           lowerText.includes('keep away from ignition');
  }

  /**
   * Extract equipment from text
   */
  static extractEquipment(text: string): string[] {
    const equipment: string[] = [];
    const lowerText = text.toLowerCase();

    const equipmentKeywords: Record<string, string> = {
      'mop bucket': 'mop bucket',
      'autoscrubber': 'autoscrubber',
      'spray bottle': 'spray bottle',
      'trigger spray': 'spray bottle',
      'steam cleaner': 'steam cleaner',
      'pressure washer': 'pressure washer',
      'extraction machine': 'extraction machine',
      'buffing machine': 'buffing machine',
      'microfibre': 'microfibre mop',
      'scrubbing brush': 'scrubbing brush',
      'ultrasonic': 'ultrasonic tank'
    };

    for (const [keyword, equip] of Object.entries(equipmentKeywords)) {
      if (lowerText.includes(keyword)) {
        equipment.push(equip);
      }
    }

    return Array.from(new Set(equipment));
  }

  /**
   * Build category entity
   */
  static buildCategoryEntity(categoryName: string, categorySlug: string): Record<string, unknown> {
    const entityId = `agar_category_${categorySlug.replace(/[^a-z0-9]/g, '_')}`;

    return {
      name: entityId,
      entityType: 'product_category',
      observations: [
        `Category: ${categoryName}`
      ],
      metadata: {
        category_name: categoryName,
        category_slug: categorySlug,
        product_count: 0
      }
    };
  }

  /**
   * Build brand entity (Agar)
   */
  static buildBrandEntity(): Record<string, unknown> {
    return {
      name: 'agar_brand_agar',
      entityType: 'brand',
      observations: [
        'Manufacturer: Agar Cleaning Systems',
        'Tagline: The Chemistry of Cleaning',
        'Australian Made and Owned'
      ],
      metadata: {
        brand_name: 'Agar',
        website: 'https://agar.com.au',
        country: 'Australia',
        full_name: 'Agar Cleaning Systems Pty Ltd'
      }
    };
  }

  /**
   * Build relationship: product -> brand
   */
  static buildManufacturedByRelation(productEntityId: string): Record<string, unknown> {
    return {
      from: productEntityId,
      to: 'agar_brand_agar',
      relationType: 'manufactured_by',
      metadata: {
        manufacturer: 'Agar Cleaning Systems'
      }
    };
  }

  /**
   * Build relationship: product -> category
   */
  static buildBelongsToCategoryRelation(
    productEntityId: string,
    categoryEntityId: string,
    categoryName: string
  ): Record<string, unknown> {
    return {
      from: productEntityId,
      to: categoryEntityId,
      relationType: 'belongs_to_category',
      metadata: {
        category: categoryName
      }
    };
  }

  /**
   * Parse surfaces from text content
   */
  static parseSurfaces(text: string): string[] {
    const surfaces: string[] = [];

    // Common surface keywords to extract
    const surfaceKeywords = [
      'vinyl', 'timber', 'terrazzo', 'marble', 'terracotta', 'slate',
      'linoleum', 'brick', 'ceramic', 'porcelain', 'tile', 'stone',
      'concrete', 'stainless steel', 'glass', 'chrome', 'plastic',
      'carpet', 'fabric', 'upholstery', 'granite', 'limestone'
    ];

    const lowerText = text.toLowerCase();

    for (const surface of surfaceKeywords) {
      if (lowerText.includes(surface)) {
        surfaces.push(surface);
      }
    }

    return Array.from(new Set(surfaces)); // Remove duplicates
  }

  /**
   * Parse problems/cleaning tasks from text
   */
  static parseProblems(text: string): string[] {
    const problems: string[] = [];

    const problemKeywords = [
      'rust', 'scale', 'lime', 'grease', 'oil', 'dirt', 'stain',
      'grime', 'mold', 'mildew', 'soap scum', 'hard water',
      'calcium', 'buildup', 'deposit', 'residue', 'film',
      'bacteria', 'odor', 'discoloration', 'tarnish'
    ];

    const lowerText = text.toLowerCase();

    for (const problem of problemKeywords) {
      if (lowerText.includes(problem)) {
        problems.push(problem);
      }
    }

    return Array.from(new Set(problems));
  }

  /**
   * Extract technical properties from text
   */
  static extractTechnicalData(text: string): Record<string, unknown> {
    const technical: Record<string, unknown> = {};

    // Extract pH (various formats - handle ?, -, and – as separators)
    const phMatch = text.match(/ph\s*[=:]\s*([\d.]+)\s*[?-–]\s*([\d.]+)/i) ||
                   text.match(/ph\s*[=:]\s*([\d.]+)/i);
    if (phMatch) {
      if (phMatch[2]) {
        technical.ph_min = parseFloat(phMatch[1]);
        technical.ph_max = parseFloat(phMatch[2]);
        technical.ph = `${phMatch[1]}-${phMatch[2]}`;
      } else {
        technical.ph = parseFloat(phMatch[1]);
      }
    }

    // Extract coverage
    const coverageMatch = text.match(/coverage[:\s]*([\d.]+)\s*[-–]\s*([\d.]+)\s*sq\s*metres/i);
    if (coverageMatch) {
      technical.coverage_min = parseFloat(coverageMatch[1]);
      technical.coverage_max = parseFloat(coverageMatch[2]);
      technical.coverage_unit = 'sq metres per litre';
    }

    // Extract color (handle ? as field separator)
    const colorMatch = text.match(/colou?r[\s:?–-]+([\w\s]+?)(?:\s{2,}|odou?r|appearance|$)/i);
    if (colorMatch) {
      technical.color = colorMatch[1].trim();
    }

    // Extract odor (handle ? as field separator)
    const odorMatch = text.match(/odou?r[\s:?–-]+([\w\s]+?)(?:\s{2,}|ph|colou?r|appearance|$)/i);
    if (odorMatch) {
      technical.odor = odorMatch[1].trim();
    }

    // Extract appearance (handle ? as field separator)
    const appearanceMatch = text.match(/appearance[\s:?–-]+([\w\s]+?)(?:\s{2,}|ph|colou?r|$)/i);
    if (appearanceMatch) {
      technical.appearance = appearanceMatch[1].trim();
    }

    // Extract container sizes (e.g., "5L", "20L", "Available in 5L and 20L")
    const containerMatches = text.match(/(\d+)\s*[Ll](?:itre|iter)?s?/g);
    if (containerMatches) {
      const sizes = containerMatches
        .map(m => {
          const match = m.match(/(\d+)/);
          return match ? `${match[1]}L` : null;
        })
        .filter(Boolean);

      if (sizes.length > 0) {
        technical.container_sizes = Array.from(new Set(sizes)); // Remove duplicates
      }
    }

    // Extract specific gravity / density
    const densityMatch = text.match(/(?:specific\s+gravity|density)[:\s]*([\d.]+)/i);
    if (densityMatch) {
      technical.specific_gravity = parseFloat(densityMatch[1]);
    }

    // Extract flash point
    const flashPointMatch = text.match(/flash\s*point[:\s]*([\d.]+)\s*°?c/i);
    if (flashPointMatch) {
      technical.flash_point = `${flashPointMatch[1]}°C`;
    }

    // Extract boiling point
    const boilingPointMatch = text.match(/boiling\s*point[:\s]*([\d.]+)\s*°?c/i);
    if (boilingPointMatch) {
      technical.boiling_point = `${boilingPointMatch[1]}°C`;
    }

    // Extract viscosity
    const viscosityMatch = text.match(/viscosity[:\s]*([\d.]+)/i);
    if (viscosityMatch) {
      technical.viscosity = parseFloat(viscosityMatch[1]);
    }

    return technical;
  }

  /**
   * Check if text contains safety information
   */
  static hasSafetyInfo(text: string): boolean {
    const safetyKeywords = [
      'safety', 'hazard', 'warning', 'caution', 'danger',
      'protective', 'gloves', 'goggles', 'ventilation',
      'first aid', 'disposal', 'sds', 'msds'
    ];

    const lowerText = text.toLowerCase();
    return safetyKeywords.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Check if text contains dilution ratio information
   */
  static hasDilutionRatios(text: string): boolean {
    // Look for patterns like "1:20", "1:10", etc.
    return /\d+:\d+/.test(text) || /dilut/i.test(text);
  }

  /**
   * Build equipment entity
   */
  static buildEquipmentEntity(equipment: EquipmentType): Record<string, unknown> {
    return {
      name: equipment.name,
      entityType: 'equipment_type',
      equipment_category: equipment.category,
      observations: [
        `Equipment: ${equipment.equipment_name}`,
        `Category: ${equipment.category}`
      ],
      metadata: {
        equipment_name: equipment.equipment_name,
        compatible_products: []
      }
    };
  }

  /**
   * Build requires_equipment relationship
   */
  static buildRequiresEquipmentRelation(
    productEntityId: string,
    equipmentName: string,
    requirementType: 'required' | 'recommended' | 'optional' = 'recommended'
  ): Record<string, unknown> {
    // Normalize equipment name to entity ID
    const equipmentId = `agar_equipment_${equipmentName.toLowerCase().replace(/\s+/g, '_')}`;

    return {
      from: productEntityId,
      to: equipmentId,
      relationType: 'requires_equipment',
      metadata: {
        requirement_type: requirementType,
        equipment_name: equipmentName
      }
    };
  }

  /**
   * Build incompatible_with relationship
   */
  static buildIncompatibleWithRelation(
    productEntityId: string,
    surfaceName: string,
    reason: string,
    severity: 'info' | 'warning' | 'caution' | 'critical' = 'warning',
    sourceText?: string
  ): Record<string, unknown> {
    // Normalize surface name to entity ID
    const surfaceId = `agar_surface_${surfaceName.toLowerCase().replace(/\s+/g, '_')}`;

    return {
      from: productEntityId,
      to: surfaceId,
      relationType: 'incompatible_with',
      metadata: {
        reason,
        severity,
        source_text: sourceText || ''
      }
    };
  }

  /**
   * Build surface_type entity
   */
  static buildSurfaceEntity(
    surfaceName: string,
    category?: 'floor' | 'wall' | 'fixture' | 'fabric' | 'outdoor' | 'equipment' | 'vehicle',
    sensitivityLevel?: 'normal' | 'acid-sensitive' | 'alkali-sensitive' | 'delicate'
  ): Record<string, unknown> {
    const surfaceId = `agar_surface_${surfaceName.toLowerCase().replace(/\s+/g, '_')}`;

    return {
      name: surfaceId,
      entityType: 'surface_type',
      ...(category && { surface_category: category }),
      ...(sensitivityLevel && { sensitivity_level: sensitivityLevel }),
      observations: [
        `Surface: ${surfaceName}`
      ],
      metadata: {
        surface_name: surfaceName,
        compatible_products: [],
        incompatible_products: []
      }
    };
  }

  /**
   * Get all standard equipment entities
   */
  static getAllEquipmentEntities(): Record<string, unknown>[] {
    return STANDARD_EQUIPMENT.map(eq => this.buildEquipmentEntity(eq));
  }

  /**
   * Match equipment name to standard equipment entity ID
   */
  static matchEquipmentToEntityId(equipmentName: string): string | null {
    const lowerName = equipmentName.toLowerCase();

    for (const eq of STANDARD_EQUIPMENT) {
      if (eq.equipment_name.toLowerCase() === lowerName ||
          eq.name.includes(lowerName.replace(/\s+/g, '_'))) {
        return eq.name;
      }
    }

    // Partial match
    for (const eq of STANDARD_EQUIPMENT) {
      if (lowerName.includes(eq.equipment_name.toLowerCase().split(' ')[0])) {
        return eq.name;
      }
    }

    return null;
  }

  // ============================================================================
  // CATALOG-BASED EXTRACTION METHODS
  // These methods use the EntityTypeCatalog for synonym-aware extraction
  // ============================================================================

  /**
   * Extract entities from text using catalog (synonym-aware)
   *
   * @param text - Text to extract from
   * @param catalog - Loaded CatalogLoader instance
   * @param entityTypes - Optional filter for specific entity types
   * @returns Array of extraction results with graph entity names
   */
  static extractWithCatalog(
    text: string,
    catalog: CatalogLoader,
    entityTypes?: string[]
  ): ExtractionResult[] {
    return catalog.extractFromText(text, entityTypes);
  }

  /**
   * Extract surfaces using catalog (synonym-aware)
   * Falls back to legacy parseSurfaces if catalog not provided
   *
   * @param text - Text to extract from
   * @param catalog - Optional CatalogLoader instance
   * @returns Array of surface names (graph entity names if catalog provided)
   */
  static parseSurfacesWithCatalog(text: string, catalog?: CatalogLoader): string[] {
    if (catalog) {
      const results = catalog.extractFromText(text, ['surface_type']);
      return results.map(r => r.graphEntityName);
    }
    // Fallback to legacy method
    return this.parseSurfaces(text);
  }

  /**
   * Extract problems using catalog (synonym-aware)
   * Falls back to legacy parseProblems if catalog not provided
   *
   * @param text - Text to extract from
   * @param catalog - Optional CatalogLoader instance
   * @returns Array of problem names (graph entity names if catalog provided)
   */
  static parseProblemsWithCatalog(text: string, catalog?: CatalogLoader): string[] {
    if (catalog) {
      const results = catalog.extractFromText(text, ['problem_type']);
      return results.map(r => r.graphEntityName);
    }
    // Fallback to legacy method
    return this.parseProblems(text);
  }

  /**
   * Extract equipment using catalog (synonym-aware)
   * Falls back to legacy extractEquipment if catalog not provided
   *
   * @param text - Text to extract from
   * @param catalog - Optional CatalogLoader instance
   * @returns Array of equipment names (graph entity names if catalog provided)
   */
  static extractEquipmentWithCatalog(text: string, catalog?: CatalogLoader): string[] {
    if (catalog) {
      const results = catalog.extractFromText(text, ['equipment_type']);
      return results.map(r => r.graphEntityName);
    }
    // Fallback to legacy method
    return this.extractEquipment(text);
  }

  /**
   * Extract contexts/applications using catalog (synonym-aware)
   *
   * @param text - Text to extract from
   * @param catalog - Optional CatalogLoader instance
   * @returns Array of context names (graph entity names if catalog provided)
   */
  static extractContextsWithCatalog(text: string, catalog?: CatalogLoader): string[] {
    if (catalog) {
      const results = catalog.extractFromText(text, ['cleaning_context']);
      return results.map(r => r.graphEntityName);
    }
    return [];
  }

  /**
   * Extract benefits using catalog (synonym-aware)
   * Falls back to legacy extractKeyBenefits if catalog not provided
   *
   * @param text - Text to extract from
   * @param catalog - Optional CatalogLoader instance
   * @returns Array of benefit names (graph entity names if catalog provided)
   */
  static extractBenefitsWithCatalog(text: string, catalog?: CatalogLoader): string[] {
    if (catalog) {
      const results = catalog.extractFromText(text, ['product_benefit']);
      return results.map(r => r.graphEntityName);
    }
    // Fallback to legacy method
    return this.extractKeyBenefits(text);
  }

  /**
   * Extract certifications using catalog (synonym-aware)
   * Falls back to legacy extractEnvironmentalCertifications if catalog not provided
   *
   * @param text - Text to extract from
   * @param catalog - Optional CatalogLoader instance
   * @returns Array of certification names (graph entity names if catalog provided)
   */
  static extractCertificationsWithCatalog(text: string, catalog?: CatalogLoader): string[] {
    if (catalog) {
      const results = catalog.extractFromText(text, ['certification']);
      return results.map(r => r.graphEntityName);
    }
    // Fallback to legacy method
    return this.extractEnvironmentalCertifications(text);
  }

  /**
   * Discover new terms that aren't in the catalog
   * Compares legacy extraction results with catalog extraction
   *
   * @param text - Text to analyze
   * @param catalog - CatalogLoader instance
   * @param context - Context string for discovery queue
   */
  static discoverNewTerms(text: string, catalog: CatalogLoader, context?: string): void {
    const contextStr = context || text.substring(0, 200);

    // Discover new surfaces
    const legacySurfaces = this.parseSurfaces(text);
    const catalogSurfaces = catalog.extractFromText(text, ['surface_type']);
    const catalogSurfaceTerms = new Set(catalogSurfaces.map(r => r.primaryTerm.toLowerCase()));

    for (const surface of legacySurfaces) {
      if (!catalogSurfaceTerms.has(surface.toLowerCase())) {
        catalog.addDiscovery('surface_type', surface, contextStr);
      }
    }

    // Discover new problems
    const legacyProblems = this.parseProblems(text);
    const catalogProblems = catalog.extractFromText(text, ['problem_type']);
    const catalogProblemTerms = new Set(catalogProblems.map(r => r.primaryTerm.toLowerCase()));

    for (const problem of legacyProblems) {
      if (!catalogProblemTerms.has(problem.toLowerCase())) {
        catalog.addDiscovery('problem_type', problem, contextStr);
      }
    }

    // Discover new equipment
    const legacyEquipment = this.extractEquipment(text);
    const catalogEquipment = catalog.extractFromText(text, ['equipment_type']);
    const catalogEquipmentTerms = new Set(catalogEquipment.map(r => r.primaryTerm.toLowerCase()));

    for (const equipment of legacyEquipment) {
      if (!catalogEquipmentTerms.has(equipment.toLowerCase())) {
        catalog.addDiscovery('equipment_type', equipment, contextStr);
      }
    }
  }
}

export default EntityBuilder;
