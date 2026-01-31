/**
 * PDS Section Detector
 * Identifies logical sections in Agar Product Data Sheets
 * Uses file-based chunking strategy with section detection
 */

export interface PDFPage {
  pageNumber: number;
  text: string;
}

export interface PDSSection {
  sectionType: string;
  heading: string;
  content: string;
  pageNumber: number;
  startPosition: number;
  endPosition: number;
  tokenCount: number;
}

export class PDSSectionDetector {

  // Agar PDS section patterns (ordered by typical appearance)
  private static SECTION_PATTERNS = [
    { pattern: /What is .+\?/i, type: 'overview' },
    { pattern: /Key Benefits/i, type: 'benefits' },
    { pattern: /How Does It Work\?/i, type: 'mechanism' },
    { pattern: /For Use On/i, type: 'applications' },
    { pattern: /Suitable For/i, type: 'applications' },
    { pattern: /Technical Data/i, type: 'technical' },
    { pattern: /Composition/i, type: 'technical' },
    { pattern: /Properties/i, type: 'technical' },
    { pattern: /Environmental Care/i, type: 'environmental' },
    { pattern: /Colour Coding/i, type: 'other' },
    { pattern: /Quality/i, type: 'quality_certification' },
    { pattern: /Application/i, type: 'instructions' },
    { pattern: /Directions/i, type: 'instructions' },
    { pattern: /How to Use/i, type: 'instructions' },
    { pattern: /Safety Precautions/i, type: 'safety' },
    { pattern: /First Aid/i, type: 'safety' },
    { pattern: /Disposal Information/i, type: 'disposal' },
    { pattern: /Empty Packaging/i, type: 'disposal' },
    { pattern: /Available in/i, type: 'availability' },
    { pattern: /Dispensing Accessories/i, type: 'accessories' }
  ];

  /**
   * Extract sections from PDF pages
   */
  public detectSections(pages: PDFPage[]): PDSSection[] {
    const sections: PDSSection[] = [];

    for (const page of pages) {
      const pageSections = this.detectSectionsInPage(page.text, page.pageNumber);
      sections.push(...pageSections);
    }

    // Post-process: merge related sections, handle splits
    return this.postProcessSections(sections);
  }

  /**
   * Detect sections within a single page
   */
  private detectSectionsInPage(pageText: string, pageNumber: number): PDSSection[] {
    const sections: PDSSection[] = [];
    const matches: Array<{ pattern: RegExp; type: string; match: RegExpMatchArray }> = [];

    // Find all section headers in the page
    for (const { pattern, type } of PDSSectionDetector.SECTION_PATTERNS) {
      const regex = new RegExp(pattern.source, 'gi');
      let match;

      while ((match = regex.exec(pageText)) !== null) {
        matches.push({
          pattern,
          type,
          match
        });
      }
    }

    // Sort matches by position
    matches.sort((a, b) => a.match.index! - b.match.index!);

    // Create sections based on boundaries
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const next = matches[i + 1];

      const startPos = current.match.index!;
      const endPos = next ? next.match.index! : pageText.length;

      const content = pageText.substring(startPos, endPos).trim();

      sections.push({
        sectionType: current.type,
        heading: current.match[0],
        content,
        pageNumber,
        startPosition: startPos,
        endPosition: endPos,
        tokenCount: this.estimateTokens(content)
      });
    }

    return sections;
  }

  /**
   * Post-process sections: merge small ones, split large ones
   */
  private postProcessSections(sections: PDSSection[]): PDSSection[] {
    const processed: PDSSection[] = [];
    const MIN_TOKENS = 50;
    const MAX_TOKENS = 600;
    const TARGET_TOKENS = 400;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];

      // If section is too small, try to merge with next
      if (section.tokenCount < MIN_TOKENS && i < sections.length - 1) {
        const next = sections[i + 1];
        if (section.tokenCount + next.tokenCount <= MAX_TOKENS) {
          // Merge
          processed.push({
            ...section,
            content: section.content + '\n\n' + next.content,
            heading: `${section.heading} + ${next.heading}`,
            sectionType: section.sectionType, // Keep first section's type
            endPosition: next.endPosition,
            tokenCount: section.tokenCount + next.tokenCount
          });
          i++; // Skip next section (it's merged)
          continue;
        }
      }

      // If section is too large, split it
      if (section.tokenCount > MAX_TOKENS) {
        const subSections = this.splitLargeSection(section, TARGET_TOKENS);
        processed.push(...subSections);
      } else {
        processed.push(section);
      }
    }

    return processed;
  }

  /**
   * Split a large section into smaller chunks with overlap
   */
  private splitLargeSection(section: PDSSection, targetTokens: number): PDSSection[] {
    const chunks: PDSSection[] = [];
    const sentences = this.splitIntoSentences(section.content);

    let currentChunk = '';
    let currentTokens = 0;
    let partIndex = 0;

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence);

      if (currentTokens + sentenceTokens > targetTokens && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          ...section,
          heading: `${section.heading} (Part ${partIndex + 1})`,
          content: currentChunk.trim(),
          tokenCount: currentTokens
        });

        // Start new chunk with overlap (last sentence)
        currentChunk = sentence + ' ';
        currentTokens = sentenceTokens;
        partIndex++;
      } else {
        currentChunk += sentence + ' ';
        currentTokens += sentenceTokens;
      }
    }

    // Add final chunk
    if (currentChunk.trim()) {
      chunks.push({
        ...section,
        heading: `${section.heading} (Part ${partIndex + 1})`,
        content: currentChunk.trim(),
        tokenCount: currentTokens
      });
    }

    return chunks;
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    // Simple sentence splitting (can be enhanced with NLP)
    return text.split(/[.!?]+\s+/).filter(s => s.trim().length > 0);
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}
