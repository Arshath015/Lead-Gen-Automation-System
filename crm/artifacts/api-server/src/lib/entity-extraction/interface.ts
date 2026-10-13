export type DetectionMethod = "exact" | "synonym" | "fuzzy" | "value_pattern" | "unmatched";

export interface ColumnAnalysis {
  sourceColumn: string;
  suggestedField: string | null;
  confidence: number;
  isCombined: boolean;
  combinedFields: string[];
  detectionMethod: DetectionMethod;
  sampleValues: string[];
}

export interface ExtractedFields {
  [field: string]: string;
}

export interface EntityExtractionService {
  analyzeColumns(headers: string[], sampleRows: Record<string, string>[]): Promise<ColumnAnalysis[]>;
  extractFromCombined(value: string, column?: string): ExtractedFields;
  cleanValue(value: string, field: string): string;
}
