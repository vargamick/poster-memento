/**
 * Observation Parser Utility
 *
 * Parses unstructured observations array into structured fields
 * for schema v2.1.0 migration.
 *
 * Adapted from scripts/agar-processing/utils/observation-parser.ts
 * for use within the processing service.
 */

/**
 * Dilution ratio structure
 */
export interface DilutionRatio {
  use_case: string;
  ratio: string;
  notes?: string;
}

/**
 * Structured product data extracted from observations
 */
export interface StructuredProductData {
  // Required fields
  product_name: string;
  product_code: string;
  overview: string;
  description: string;
  container_sizes: string[];

  // Optional fields
  ph?: number;
  ph_min?: number;
  ph_max?: number;
  color?: string;
  odor?: string;
  appearance?: string;
  foam_level?: 'none' | 'low' | 'medium' | 'high';
  dilution_ratios?: DilutionRatio[];
  safety_warnings?: string[];
  incompatible_surfaces?: string[];
  incompatible_materials?: string[];
  key_benefits?: string[];
  application_methods?: string[];
  suitable_equipment?: string[];
  environmental_certifications?: string[];
  flammable?: boolean;
  ready_to_use?: boolean;

  // Legacy
  observations?: string[];
}

/**
 * Incompatible surface info for relationship creation
 */
export interface IncompatibleSurfaceInfo {
  surface: string;
  reason: string;
  severity: 'info' | 'warning' | 'caution' | 'critical';
  source_text: string;
}

/**
 * Parse observations array into structured fields
 */
export class ObservationParser {

  /**
   * Main entry point - parse observations to structured data
   */
  static parseObservations(
    observations: string[],
    productName?: string,
    pdfFilename?: string
  ): StructuredProductData {
    const result: StructuredProductData = {
      product_name: '',
      product_code: '',
      overview: '',
      description: '',
      container_sizes: [],
      observations: [] // For unprocessed data
    };

    // Extract product name
    result.product_name = this.extractField(observations, 'Product:') || productName || '';

    // Generate product code from filename or product name
    result.product_code = this.deriveProductCode(result.product_name, pdfFilename);

    // Extract overview
    result.overview = this.extractOverview(observations);

    // Extract description
    result.description = this.extractDescription(observations);

    // Extract container sizes
    result.container_sizes = this.extractContainerSizes(observations);

    // Extract pH values
    const phData = this.extractPH(observations);
    if (phData.ph !== undefined) result.ph = phData.ph;
    if (phData.ph_min !== undefined) result.ph_min = phData.ph_min;
    if (phData.ph_max !== undefined) result.ph_max = phData.ph_max;

    // Extract color
    const color = this.extractField(observations, 'Color:') ||
                  this.extractField(observations, 'Colour:');
    if (color && this.isValidColor(color)) {
      result.color = color;
    }

    // Extract odor
    const odor = this.extractField(observations, 'Odor:') ||
                 this.extractField(observations, 'Odour:');
    if (odor) {
      result.odor = odor;
    }

    // Extract safety warnings from description
    result.safety_warnings = this.extractSafetyWarnings(result.description);

    // Extract incompatible surfaces from description
    result.incompatible_surfaces = this.extractIncompatibleSurfaces(result.description);

    // Extract dilution ratios
    result.dilution_ratios = this.extractDilutionRatios(result.description);

    // Determine ready_to_use
    result.ready_to_use = !result.dilution_ratios || result.dilution_ratios.length === 0;

    // Extract application methods
    result.application_methods = this.extractApplicationMethods(result.description);

    // Extract foam level
    result.foam_level = this.extractFoamLevel(result.description);

    // Extract key benefits
    result.key_benefits = this.extractKeyBenefits(result.overview);

    // Extract environmental certifications
    result.environmental_certifications = this.extractEnvironmentalCertifications(
      result.overview + ' ' + result.description
    );

    // Check flammability
    result.flammable = this.checkFlammability(result.description);

    // Extract suitable equipment
    result.suitable_equipment = this.extractEquipment(result.description);

    // Collect unprocessed observations
    result.observations = this.collectUnprocessedObservations(observations, result);

    return result;
  }

  /**
   * Extract a simple field by prefix
   */
  static extractField(observations: string[], prefix: string): string | null {
    const obs = observations.find(o => o.startsWith(prefix));
    return obs ? obs.substring(prefix.length).trim() : null;
  }

  /**
   * Derive product code from product name or PDF filename
   */
  static deriveProductCode(productName: string, pdfFilename?: string): string {
    // Try to get from filename first (e.g., "PH-7_PDS.pdf" -> "PH7")
    if (pdfFilename) {
      const fileCode = pdfFilename
        .replace(/_PDS\.pdf$/i, '')
        .replace(/_SDS\.pdf$/i, '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase();
      if (fileCode) return fileCode;
    }

    // Fallback to product name
    return productName
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .substring(0, 20); // Limit length
  }

  /**
   * Extract overview (What is X? section)
   */
  static extractOverview(observations: string[]): string {
    // Look for "Overview:" or "What is" patterns
    const overviewObs = observations.find(o =>
      o.startsWith('Overview:') || o.toLowerCase().includes('what is')
    );

    if (overviewObs) {
      // Clean up and extract the actual content
      let text = overviewObs
        .replace(/^Overview:\s*/i, '')
        .replace(/^What is \w+\??\s*/i, '');

      // Remove product name prefix if present (e.g., "What is DEMOLISH?DEMOLISH is...")
      const productNameMatch = text.match(/^(\w+)\s+is\s+/i);
      if (productNameMatch) {
        // Keep the text after removing duplicate product name
        text = text.replace(/^\w+\s+is\s+/, '');
        text = productNameMatch[1] + ' is ' + text;
      }

      return text.trim();
    }

    return '';
  }

  /**
   * Extract description (How Does It Work + For Use On sections)
   */
  static extractDescription(observations: string[]): string {
    const descObs = observations.find(o => o.startsWith('Description:'));

    if (descObs) {
      let text = descObs.replace(/^Description:\s*/i, '');

      // Clean up common formatting issues
      text = text
        .replace(/DescriptionHow Does It Work\?/gi, '')
        .replace(/How Does It Work\?/gi, '')
        .trim();

      return text;
    }

    return '';
  }

  /**
   * Extract container sizes from observations
   */
  static extractContainerSizes(observations: string[]): string[] {
    const containerObs = observations.find(o =>
      o.toLowerCase().includes('container size')
    );

    if (containerObs) {
      // Extract the sizes part after the colon
      const match = containerObs.match(/Container Sizes?[:\s]+(.+)$/i);
      if (match) {
        const sizesStr = match[1];
        // Split on comma and clean up
        const sizes = sizesStr
          .split(',')
          .map(s => s.trim())
          .filter(s => /^\d+/.test(s)); // Must start with a number

        // Normalize to standard format (e.g., "5 L" -> "5L")
        return sizes.map(s => s.replace(/\s+/g, '').toUpperCase());
      }
    }

    return [];
  }

  /**
   * Extract pH values (single value or range)
   */
  static extractPH(observations: string[]): { ph?: number; ph_min?: number; ph_max?: number } {
    const result: { ph?: number; ph_min?: number; ph_max?: number } = {};

    // Look for pH observations
    const phObs = observations.find(o => /^ph\s*[:\s]/i.test(o));
    const phMinObs = observations.find(o => /^ph\s*min/i.test(o));
    const phMaxObs = observations.find(o => /^ph\s*max/i.test(o));

    // Extract pH min
    if (phMinObs) {
      const minMatch = phMinObs.match(/(\d+\.?\d*)/);
      if (minMatch) {
        const val = parseFloat(minMatch[1]);
        if (val >= 0 && val <= 14) {
          result.ph_min = val;
        }
      }
    }

    // Extract pH max
    if (phMaxObs) {
      const maxMatch = phMaxObs.match(/(\d+\.?\d*)/);
      if (maxMatch) {
        const val = parseFloat(maxMatch[1]);
        if (val >= 0 && val <= 14) {
          result.ph_max = val;
        }
      }
    }

    // Extract single pH or range from "Ph: X-Y" format
    if (phObs && !phMinObs && !phMaxObs) {
      // Try range format "12.0-13.0"
      const rangeMatch = phObs.match(/(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)/);
      if (rangeMatch) {
        const min = parseFloat(rangeMatch[1]);
        const max = parseFloat(rangeMatch[2]);

        // Validate and handle swapped values
        if (min >= 0 && min <= 14 && max >= 0 && max <= 14) {
          result.ph_min = Math.min(min, max);
          result.ph_max = Math.max(min, max);
        }
      } else {
        // Try single value
        const singleMatch = phObs.match(/(\d+\.?\d*)/);
        if (singleMatch) {
          const val = parseFloat(singleMatch[1]);
          if (val >= 0 && val <= 14) {
            result.ph = val;
          }
        }
      }
    }

    // If we have min and max, also set the middle as the single pH value
    if (result.ph_min !== undefined && result.ph_max !== undefined && result.ph === undefined) {
      result.ph = (result.ph_min + result.ph_max) / 2;
    }

    return result;
  }

  /**
   * Validate color string (filter out garbage)
   */
  static isValidColor(color: string): boolean {
    // Skip values that look like parsing errors
    const invalidPatterns = [
      /fastness/i,
      /^\d+$/,
      /^on\s/i,
      /^and\s/i
    ];

    return !invalidPatterns.some(p => p.test(color));
  }

  /**
   * Extract safety warnings from description text
   */
  static extractSafetyWarnings(description: string): string[] {
    const warnings: string[] = [];

    // Pattern: "CAUTION: ..." or "WARNING: ..."
    const cautionMatches = description.match(/(?:CAUTION|WARNING)[:\s]+(.+?)(?:\.|$)/gi);
    if (cautionMatches) {
      warnings.push(...cautionMatches.map(m => m.trim()));
    }

    // Pattern: "DO NOT ..."
    const doNotMatches = description.match(/DO NOT\s+[^.]+\./gi);
    if (doNotMatches) {
      warnings.push(...doNotMatches.map(m => m.trim()));
    }

    // Pattern: "Avoid ..."
    const avoidMatches = description.match(/Avoid\s+[^.]+\./gi);
    if (avoidMatches) {
      warnings.push(...avoidMatches.map(m => m.trim()));
    }

    return Array.from(new Set(warnings)); // Deduplicate
  }

  /**
   * Extract incompatible surfaces for relationship creation
   */
  static extractIncompatibleSurfaces(description: string): string[] {
    const surfaces: string[] = [];

    // Pattern: "DO NOT use on X"
    const doNotUseMatches = description.match(/DO NOT use (?:on )?([^.]+?)(?:\.|,|$)/gi);
    if (doNotUseMatches) {
      for (const match of doNotUseMatches) {
        const surface = match
          .replace(/DO NOT use (?:on )?/i, '')
          .replace(/\.$/, '')
          .trim()
          .toLowerCase();
        if (surface && surface.length < 100) {
          surfaces.push(surface);
        }
      }
    }

    // Pattern: "NOT suitable for X"
    const notSuitableMatches = description.match(/NOT suitable for(?: use on)? ([^.]+?)(?:\.|,|$)/gi);
    if (notSuitableMatches) {
      for (const match of notSuitableMatches) {
        const surface = match
          .replace(/NOT suitable for(?: use on)?/i, '')
          .replace(/\.$/, '')
          .trim()
          .toLowerCase();
        if (surface && surface.length < 100) {
          surfaces.push(surface);
        }
      }
    }

    // Pattern: "Not for use on X"
    const notForUseMatches = description.match(/Not for use on ([^.]+?)(?:\.|,|$)/gi);
    if (notForUseMatches) {
      for (const match of notForUseMatches) {
        const surface = match
          .replace(/Not for use on/i, '')
          .replace(/\.$/, '')
          .trim()
          .toLowerCase();
        if (surface && surface.length < 100) {
          surfaces.push(surface);
        }
      }
    }

    return Array.from(new Set(surfaces)); // Deduplicate
  }

  /**
   * Get detailed incompatible surface info for relationship creation
   */
  static getIncompatibleSurfaceDetails(description: string): IncompatibleSurfaceInfo[] {
    const results: IncompatibleSurfaceInfo[] = [];

    // Pattern: "DO NOT use on X because/as Y"
    const patterns = [
      /DO NOT use (?:on )?(.+?)(?: as | because | since )(.+?)(?:\.|$)/gi,
      /NOT suitable for(?: use on)? (.+?)(?: as | because | since )(.+?)(?:\.|$)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const surface = match[1].trim().toLowerCase();
        const reason = match[2].trim();

        results.push({
          surface,
          reason,
          severity: this.determineSeverity(reason),
          source_text: match[0].trim()
        });
      }
    }

    // Also extract simple patterns without reason
    const simplePatterns = [
      /DO NOT use (?:on )?([^,.]+)/gi,
      /NOT suitable for ([^,.]+)/gi
    ];

    for (const pattern of simplePatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const surface = match[1].trim().toLowerCase();

        // Skip if we already have this surface with a reason
        if (!results.some(r => r.surface === surface)) {
          results.push({
            surface,
            reason: 'Product is not recommended for this surface',
            severity: 'warning',
            source_text: match[0].trim()
          });
        }
      }
    }

    return results;
  }

  /**
   * Determine severity based on reason text
   */
  static determineSeverity(reason: string): 'info' | 'warning' | 'caution' | 'critical' {
    const lowerReason = reason.toLowerCase();

    if (lowerReason.includes('damage') || lowerReason.includes('destroy') ||
        lowerReason.includes('etch') || lowerReason.includes('corrode')) {
      return 'critical';
    }

    if (lowerReason.includes('discolour') || lowerReason.includes('discolor') ||
        lowerReason.includes('stain') || lowerReason.includes('mark')) {
      return 'caution';
    }

    if (lowerReason.includes('may') || lowerReason.includes('might')) {
      return 'warning';
    }

    return 'warning';
  }

  /**
   * Extract dilution ratios from description
   */
  static extractDilutionRatios(description: string): DilutionRatio[] {
    const ratios: DilutionRatio[] = [];

    // Pattern: "1:X for Y" or "dilute 1:X for Y"
    const pattern = /(?:dilute\s+)?(\d+:\d+)\s*(?:for|[-–])\s*([^,.]+)/gi;
    let match;

    while ((match = pattern.exec(description)) !== null) {
      ratios.push({
        ratio: match[1],
        use_case: match[2].trim()
      });
    }

    // Pattern: standalone ratios "1:X" without context
    if (ratios.length === 0) {
      const standalonePattern = /(\d+:\d+)/g;
      let standaloneMatch;
      while ((standaloneMatch = standalonePattern.exec(description)) !== null) {
        // Skip if already captured
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
   * Extract application methods from description
   */
  static extractApplicationMethods(description: string): string[] {
    const methods: string[] = [];
    const lowerDesc = description.toLowerCase();

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
      'dip': 'dip',
      'trigger spray': 'spray',
      'foam gun': 'spray'
    };

    for (const [keyword, method] of Object.entries(methodKeywords)) {
      if (lowerDesc.includes(keyword)) {
        methods.push(method);
      }
    }

    return Array.from(new Set(methods));
  }

  /**
   * Determine foam level from description
   */
  static extractFoamLevel(description: string): 'none' | 'low' | 'medium' | 'high' | undefined {
    const lowerDesc = description.toLowerCase();

    if (lowerDesc.includes('no foam') || lowerDesc.includes('non-foaming') ||
        lowerDesc.includes('foam free')) {
      return 'none';
    }

    if (lowerDesc.includes('low foam') || lowerDesc.includes('low-foam')) {
      return 'low';
    }

    if (lowerDesc.includes('high foam') || lowerDesc.includes('rich foam') ||
        lowerDesc.includes('heavy foam')) {
      return 'high';
    }

    if (lowerDesc.includes('foam')) {
      return 'medium';
    }

    return undefined;
  }

  /**
   * Extract key benefits from overview
   */
  static extractKeyBenefits(overview: string): string[] {
    const benefits: string[] = [];

    // Common benefit patterns
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
      'eco label': 'Eco Label',
      'biodegradable': 'Biodegradable',
      'phosphate free': 'Phosphate Free',
      'phosphate-free': 'Phosphate Free',
      'environmentally friendly': 'Environmentally Friendly',
      'eco-friendly': 'Eco-Friendly'
    };

    for (const [pattern, cert] of Object.entries(certPatterns)) {
      if (lowerText.includes(pattern)) {
        certs.push(cert);
      }
    }

    return certs;
  }

  /**
   * Check if product is flammable
   */
  static checkFlammability(description: string): boolean {
    const lowerDesc = description.toLowerCase();
    return lowerDesc.includes('flammable') ||
           lowerDesc.includes('flash point') ||
           lowerDesc.includes('keep away from ignition');
  }

  /**
   * Extract equipment types from description
   */
  static extractEquipment(description: string): string[] {
    const equipment: string[] = [];
    const lowerDesc = description.toLowerCase();

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
      'ultrasonic': 'ultrasonic tank',
      'foam gun': 'foam gun',
      'dispensing system': 'dispensing system'
    };

    for (const [keyword, equip] of Object.entries(equipmentKeywords)) {
      if (lowerDesc.includes(keyword)) {
        equipment.push(equip);
      }
    }

    return Array.from(new Set(equipment));
  }

  /**
   * Collect observations that weren't parsed into structured fields
   */
  static collectUnprocessedObservations(
    observations: string[],
    _structured: StructuredProductData
  ): string[] {
    const processedPrefixes = [
      'Product:',
      'Overview:',
      'Description:',
      'Container Size',
      'Ph:',
      'Ph ',
      'Color:',
      'Colour:',
      'Odor:',
      'Odour:'
    ];

    return observations.filter(obs => {
      // Keep observations that don't match processed prefixes
      return !processedPrefixes.some(prefix =>
        obs.toLowerCase().startsWith(prefix.toLowerCase())
      );
    });
  }
}

export default ObservationParser;
