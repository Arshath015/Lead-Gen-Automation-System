import type { ColumnAnalysis, DetectionMethod, EntityExtractionService, ExtractedFields } from "./interface";

const CRM_FIELDS = [
  "companyName", "contactPerson", "email", "phone", "location",
  "designation", "industry", "linkedinUrl", "websiteUrl", "remarks",
  "comment", "source", "priority", "channel", "valueAmount", "currency",
  "expectedCloseDate", "tags",
] as const;

const SYNONYMS: Record<string, string> = {
  // companyName
  "company": "companyName", "company name": "companyName", "company_name": "companyName",
  "organisation": "companyName", "organization": "companyName", "org": "companyName",
  "business": "companyName", "business name": "companyName", "firm": "companyName",
  "account": "companyName", "account name": "companyName", "employer": "companyName",
  "client": "companyName", "client name": "companyName", "builder": "companyName",
  "developer": "companyName", "property developer": "companyName", "property company": "companyName",
  "builder name": "companyName", "group": "companyName", "brand": "companyName",
  "vendor": "companyName", "company/organisation": "companyName", "co name": "companyName",
  "co.": "companyName", "enterprise": "companyName", "corp": "companyName",
  "corporation": "companyName", "companyname": "companyName", "orgname": "companyName",

  // contactPerson
  "contact": "contactPerson", "contact person": "contactPerson", "contact_person": "contactPerson",
  "name": "contactPerson", "full name": "contactPerson", "full_name": "contactPerson",
  "person": "contactPerson", "contact name": "contactPerson", "lead name": "contactPerson",
  "poc": "contactPerson", "poc name": "contactPerson", "point of contact": "contactPerson", "representative": "contactPerson",
  "rep": "contactPerson", "salesperson": "contactPerson", "bd name": "contactPerson",
  "spoc": "contactPerson", "decision maker": "contactPerson", "first name": "contactPerson",
  "owner name": "contactPerson", "agent": "contactPerson", "contact/person": "contactPerson",
  "person name": "contactPerson", "customer name": "contactPerson",

  // email
  "email": "email", "email address": "email", "e-mail": "email", "e_mail": "email",
  "mail": "email", "mail id": "email", "email id": "email", "emailid": "email", "email_id": "email",
  "work email": "email", "business email": "email", "corporate email": "email",
  "email/contact": "email", "email addr": "email", "email address1": "email",
  "e mail": "email",

  // phone
  "phone": "phone", "phone number": "phone", "phone no": "phone", "phone no.": "phone",
  "phone_number": "phone", "mobile": "phone", "mobile number": "phone", "mobile no": "phone",
  "mobile_number": "phone", "cell": "phone", "cell phone": "phone", "telephone": "phone",
  "tel": "phone", "contact number": "phone", "whatsapp": "phone", "whatsapp number": "phone",
  "phone/mobile": "phone", "mobile/phone": "phone", "primary number": "phone",
  "contact no": "phone", "contact no.": "phone", "ph no": "phone", "ph": "phone",
  "ph.no": "phone", "mob": "phone", "mob no": "phone", "mob.": "phone",
  "primary contact": "phone", "contact phone": "phone", "phone1": "phone",
  "number": "phone",

  // location
  "location": "location", "city": "location", "address": "location", "region": "location",
  "area": "location", "country": "location", "state": "location", "place": "location",
  "locality": "location", "town": "location", "zone": "location", "territory": "location",
  "city/location": "location", "location/city": "location", "city_location": "location",
  "geography": "location", "geo": "location", "project location": "location",
  "site location": "location", "loc": "location", "loc.": "location",

  // industry
  "industry": "industry", "sector": "industry", "vertical": "industry",
  "business type": "industry", "domain": "industry", "property type": "industry",
  "asset type": "industry", "niche": "industry", "segment": "industry",
  "category": "industry", "type": "industry", "market": "industry",

  // designation
  "designation": "designation", "title": "designation", "job title": "designation",
  "position": "designation", "job role": "designation", "role": "designation",
  "job designation": "designation", "post": "designation", "rank": "designation",
  "dept": "designation", "department": "designation",

  // source (internal import-type field)
  "source": "source", "origin": "source", "referred by": "source",
  "how found": "source", "acquisition source": "source", "lead_source": "source",

  // channel (marketing channel / lead source from user's perspective)
  "lead source": "channel",

  // channel
  "channel": "channel", "marketing channel": "channel", "medium": "channel",
  "platform": "channel",

  // remarks
  "remarks": "remarks", "notes": "remarks", "note": "remarks", "comments": "remarks",
  "remark": "remarks", "description": "remarks", "details": "remarks", "info": "remarks",
  "pain points": "remarks", "requirements": "remarks", "client requirements": "remarks",
  "feedback": "remarks", "needs": "remarks", "interest": "remarks", "message": "remarks",
  "additional info": "remarks", "other info": "remarks", "extra": "remarks",

  // comment
  "comment": "comment", "internal comment": "comment", "internal note": "comment",

  // priority
  "priority": "priority", "temperature": "priority", "urgency": "priority",
  "lead temperature": "priority", "lead status": "priority", "lead priority": "priority",
  "hot/warm/cold": "priority", "status": "priority", "rating": "priority",

  // valueAmount
  "value": "valueAmount", "deal value": "valueAmount", "amount": "valueAmount",
  "revenue": "valueAmount", "budget": "valueAmount", "potential value": "valueAmount",
  "estimated value": "valueAmount", "deal amount": "valueAmount",
  "opportunity value": "valueAmount", "property size": "valueAmount",
  "size": "valueAmount", "sqft": "valueAmount", "sq.ft": "valueAmount",
  "sq ft": "valueAmount", "price": "valueAmount", "cost": "valueAmount",
  "ticket size": "valueAmount", "deal size": "valueAmount",

  // websiteUrl
  "website": "websiteUrl", "url": "websiteUrl", "web": "websiteUrl",
  "site": "websiteUrl", "website url": "websiteUrl", "web url": "websiteUrl",
  "company website": "websiteUrl", "website_url": "websiteUrl",

  // linkedinUrl
  "linkedin": "linkedinUrl", "linkedin url": "linkedinUrl", "linkedin_url": "linkedinUrl",
  "linkedin profile": "linkedinUrl", "linkedin link": "linkedinUrl",
  "linkedin profile link": "linkedinUrl", "linkedin profile url": "linkedinUrl",

  // expectedCloseDate
  "expected close date": "expectedCloseDate", "close date": "expectedCloseDate",
  "closing date": "expectedCloseDate", "expected date": "expectedCloseDate",
  "target date": "expectedCloseDate", "follow up date": "expectedCloseDate",
  "followup date": "expectedCloseDate", "next follow up": "expectedCloseDate",
  "expected closing": "expectedCloseDate", "closure date": "expectedCloseDate",
  "exp. close date": "expectedCloseDate", "exp close date": "expectedCloseDate",
  "expected closure date": "expectedCloseDate",

  // tags
  "tags": "tags", "label": "tags", "labels": "tags", "tag": "tags",
  "category tags": "tags", "keywords": "tags",
};

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /\+?[\d][\d\s\-\(\)\.]{6,18}[\d]/;
const URL_RE = /https?:\/\/[^\s,;]+/i;
const LINKEDIN_RE = /linkedin\.com/i;
const DATE_RE = /^(\d{1,4}[-\/\.]\d{1,2}[-\/\.]\d{1,4}|\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4})$/;
const CURRENCY_RE = /^[\$₹£€¥]?[\d,]+(\.\d+)?[kKmMlL]?$/;

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ").replace(/_/g, " ");
}

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

function detectByValues(values: string[]): { field: string; confidence: number } | null {
  const nonEmpty = values.filter(v => v?.trim());
  if (nonEmpty.length === 0) return null;
  const total = nonEmpty.length;

  let email = 0, phone = 0, url = 0, linkedin = 0, date = 0, currency = 0;
  for (const v of nonEmpty) {
    const t = v.trim();
    if (EMAIL_RE.test(t)) email++;
    if (LINKEDIN_RE.test(t)) linkedin++;
    else if (URL_RE.test(t)) url++;
    const digits = t.replace(/\D/g, "");
    if (PHONE_RE.test(t) && digits.length >= 7 && digits.length <= 15) phone++;
    if (DATE_RE.test(t)) date++;
    if (CURRENCY_RE.test(t.replace(/\s/g, ""))) currency++;
  }

  const pct = (n: number) => n / total;
  if (pct(linkedin) >= 0.5) return { field: "linkedinUrl", confidence: 90 };
  if (pct(url) >= 0.5) return { field: "websiteUrl", confidence: 85 };
  if (pct(email) >= 0.6) return { field: "email", confidence: 92 };
  if (pct(phone) >= 0.5) return { field: "phone", confidence: 88 };
  if (pct(date) >= 0.6) return { field: "expectedCloseDate", confidence: 80 };
  if (pct(currency) >= 0.6) return { field: "valueAmount", confidence: 75 };
  return null;
}

function isCombinedCell(values: string[]): boolean {
  const nonEmpty = values.filter(v => v?.trim());
  if (nonEmpty.length === 0) return false;
  let combined = 0;
  for (const v of nonEmpty) {
    let types = 0;
    if (EMAIL_RE.test(v)) types++;
    const digits = v.replace(/\D/g, "");
    if (PHONE_RE.test(v) && digits.length >= 7 && digits.length <= 15) types++;
    if (URL_RE.test(v)) types++;
    if (types >= 2) combined++;
  }
  return combined / nonEmpty.length >= 0.3;
}

function detectCombinedFields(values: string[]): string[] {
  const nonEmpty = values.filter(v => v?.trim());
  const fields = new Set<string>();
  for (const v of nonEmpty) {
    if (EMAIL_RE.test(v)) fields.add("email");
    const digits = v.replace(/\D/g, "");
    if (PHONE_RE.test(v) && digits.length >= 7) fields.add("phone");
    if (LINKEDIN_RE.test(v)) fields.add("linkedinUrl");
    else if (URL_RE.test(v)) fields.add("websiteUrl");
  }
  return Array.from(fields);
}

export class RuleBasedEntityExtractor implements EntityExtractionService {
  async analyzeColumns(headers: string[], sampleRows: Record<string, string>[]): Promise<ColumnAnalysis[]> {
    return headers.map(header => {
      const normalized = normalizeHeader(header);
      const sampleValues = sampleRows
        .map(r => String(r[header] ?? "").trim())
        .filter(Boolean)
        .slice(0, 10);

      // 1. Exact lookup
      if (SYNONYMS[normalized]) {
        const combined = isCombinedCell(sampleValues);
        return {
          sourceColumn: header,
          suggestedField: SYNONYMS[normalized],
          confidence: 95,
          isCombined: combined,
          combinedFields: combined ? detectCombinedFields(sampleValues) : [],
          detectionMethod: "exact" as DetectionMethod,
          sampleValues,
        };
      }

      // 2. Partial contains match — e.g. "BD Contact Phone" contains "phone"
      let partialField: string | null = null;
      let partialConfidence = 0;
      for (const [synonym, field] of Object.entries(SYNONYMS)) {
        if (synonym.length < 4) continue;
        if (normalized.includes(synonym) || synonym.includes(normalized)) {
          const overlap = Math.min(synonym.length, normalized.length) / Math.max(synonym.length, normalized.length);
          const conf = Math.round(65 + overlap * 20);
          if (conf > partialConfidence) {
            partialConfidence = conf;
            partialField = field;
          }
        }
      }
      if (partialField && partialConfidence >= 65) {
        const combined = isCombinedCell(sampleValues);
        return {
          sourceColumn: header,
          suggestedField: partialField,
          confidence: partialConfidence,
          isCombined: combined,
          combinedFields: combined ? detectCombinedFields(sampleValues) : [],
          detectionMethod: "synonym" as DetectionMethod,
          sampleValues,
        };
      }

      // 3. Fuzzy match
      let bestField: string | null = null;
      let bestDist = Infinity;
      let bestSynonymLen = 0;
      for (const [synonym, field] of Object.entries(SYNONYMS)) {
        const dist = levenshtein(normalized, synonym);
        const maxLen = Math.max(normalized.length, synonym.length);
        if (dist < bestDist || (dist === bestDist && synonym.length > bestSynonymLen)) {
          bestDist = dist;
          bestField = field;
          bestSynonymLen = synonym.length;
        }
      }
      const maxLen = Math.max(normalized.length, bestSynonymLen);
      if (bestField && bestDist <= Math.ceil(maxLen * 0.35)) {
        const conf = Math.max(40, Math.round((1 - bestDist / maxLen) * 75));
        if (conf >= 45) {
          const combined = isCombinedCell(sampleValues);
          return {
            sourceColumn: header,
            suggestedField: bestField,
            confidence: conf,
            isCombined: combined,
            combinedFields: combined ? detectCombinedFields(sampleValues) : [],
            detectionMethod: "fuzzy" as DetectionMethod,
            sampleValues,
          };
        }
      }

      // 4. Value pattern detection
      const byValue = detectByValues(sampleValues);
      if (byValue) {
        const combined = isCombinedCell(sampleValues);
        return {
          sourceColumn: header,
          suggestedField: byValue.field,
          confidence: byValue.confidence,
          isCombined: combined,
          combinedFields: combined ? detectCombinedFields(sampleValues) : [],
          detectionMethod: "value_pattern" as DetectionMethod,
          sampleValues,
        };
      }

      // 5. No match
      return {
        sourceColumn: header,
        suggestedField: null,
        confidence: 0,
        isCombined: false,
        combinedFields: [],
        detectionMethod: "unmatched" as DetectionMethod,
        sampleValues,
      };
    });
  }

  extractFromCombined(value: string, _column?: string): ExtractedFields {
    const result: ExtractedFields = {};
    const v = value.trim();

    // Extract email
    const emailMatch = v.match(EMAIL_RE);
    if (emailMatch) result.email = emailMatch[0].toLowerCase();

    // Extract LinkedIn before generic URL (more specific)
    if (LINKEDIN_RE.test(v)) {
      const urlMatch = v.match(URL_RE);
      if (urlMatch) result.linkedinUrl = urlMatch[0];
    } else {
      const urlMatch = v.match(URL_RE);
      if (urlMatch) result.websiteUrl = urlMatch[0];
    }

    // Extract phone (after masking email to avoid digits in email domain)
    const withoutEmail = v.replace(emailMatch?.[0] ?? "", "");
    const phoneMatch = withoutEmail.match(PHONE_RE);
    if (phoneMatch) {
      const digits = phoneMatch[0].replace(/\D/g, "");
      if (digits.length >= 7 && digits.length <= 15) {
        result.phone = this.cleanValue(phoneMatch[0].trim(), "phone");
      }
    }

    return result;
  }

  cleanValue(value: string, field: string): string {
    const v = (value ?? "").trim();
    if (!v) return v;

    switch (field) {
      case "phone": return cleanPhone(v);
      case "email": return v.toLowerCase();
      case "companyName": return v.replace(/\s+/g, " ").trim();
      case "contactPerson": return toTitleCase(v.replace(/\s+/g, " "));
      case "location": return toTitleCase(v.replace(/\s+/g, " "));
      case "designation": return toTitleCase(v.replace(/\s+/g, " "));
      case "industry": return toTitleCase(v.replace(/\s+/g, " "));
      case "priority": return normalizePriority(v);
      case "channel": return normalizeChannel(v);
      case "source": return normalizeSource(v);
      case "valueAmount": return extractNumericValue(v);
      case "expectedCloseDate": return normalizeDate(v);
      case "websiteUrl": return ensureProtocol(v);
      case "linkedinUrl": return ensureProtocol(v);
      default: return v.replace(/\s+/g, " ");
    }
  }
}

function cleanPhone(raw: string): string {
  let digits = raw.replace(/[^\d+]/g, "");
  // Keep leading +
  const plus = digits.startsWith("+") ? "+" : "";
  digits = digits.replace(/\+/g, "");
  // Indian mobile: 10 digits starting 6-9
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  // 91 prefix for India
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  return plus ? `+${digits}` : digits;
}

function normalizePriority(v: string): string {
  const low = v.toLowerCase();
  if (["hot", "high", "urgent", "h", "1", "🔴"].includes(low)) return "hot";
  if (["warm", "medium", "normal", "m", "2", "🟡"].includes(low)) return "warm";
  if (["cold", "low", "l", "3", "🔵"].includes(low)) return "cold";
  return v;
}

function normalizeChannel(v: string): string {
  const low = v.toLowerCase().replace(/\s+/g, "");
  if (["website", "web", "online"].includes(low)) return "website";
  if (["whatsapp", "wa", "chat"].includes(low)) return "whatsapp";
  if (["instagram", "ig", "insta"].includes(low)) return "instagram";
  if (["email", "e-mail", "mail"].includes(low)) return "email";
  if (["apollo", "apolloio"].includes(low)) return "apollo";
  if (["referral", "ref", "referred"].includes(low)) return "referral";
  if (["linkedin", "linked.in"].includes(low)) return "linkedin";
  if (["database", "db"].includes(low)) return "database";
  return "other";
}

function normalizeSource(v: string): string {
  const low = v.toLowerCase().replace(/\s+/g, "");
  if (["manual", "hand"].includes(low)) return "manual";
  if (["csv", "excel", "import", "file", "sheet"].includes(low)) return "csv_import";
  if (["api", "webhook", "integration"].includes(low)) return "api";
  if (["webform", "form", "website", "online"].includes(low)) return "web_form";
  return "csv_import";
}

function extractNumericValue(v: string): string {
  // Handle "₹50 lakhs", "50L", "50K", "1.5 Cr"
  let cleaned = v.replace(/[^\d.,kKmMlLcC]/g, "").trim();
  const lower = v.toLowerCase();
  let multiplier = 1;
  if (/crore|cr\.?/i.test(lower)) multiplier = 10000000;
  else if (/lakh|lac|l$/i.test(lower)) multiplier = 100000;
  else if (/k$/i.test(lower)) multiplier = 1000;
  else if (/m$/i.test(lower)) multiplier = 1000000;
  cleaned = cleaned.replace(/[kKmMlLcC]/g, "").replace(/,/g, "");
  const num = parseFloat(cleaned);
  if (!isNaN(num) && multiplier > 1) return String(Math.round(num * multiplier));
  return cleaned || v;
}

function normalizeDate(v: string): string {
  // Try to parse common date formats
  const cleaned = v.trim();
  // Already ISO: 2024-06-15
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) return cleaned;
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // MM/DD/YYYY (US format - ambiguous, keep as-is if day>12)
  const mdy = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    if (parseInt(m) > 12) return `${y}-${d.padStart(2, "0")}-${m.padStart(2, "0")}`;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return cleaned;
}

function ensureProtocol(v: string): string {
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.includes(".")) return `https://${v}`;
  return v;
}
