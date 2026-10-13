import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImportWizard } from "../useImportWizard";
import { api } from "../../../api/client";
import type { ImportPreviewSummary, UploadedFileDto } from "../../../types";

vi.mock("../../../api/client", () => ({
  api: {
    uploadImportFiles: vi.fn(),
    previewImport: vi.fn(),
    commitImport: vi.fn(),
    cancelImport: vi.fn(),
    importErrorsCsvUrl: vi.fn((id: string) => `/api/import/${id}/errors.csv`),
  },
}));

const mockedApi = vi.mocked(api);

const uploadResponse: { stagingId: string; files: UploadedFileDto[] } = {
  stagingId: "staging-1",
  files: [
    {
      fileId: "file-1",
      originalFilename: "leads.xlsx",
      worksheets: [
        {
          name: "Sheet1",
          headerRowNumber: 1,
          headers: ["Full Name", "Company", "Email"],
          approxDataRowCount: 100,
          suggestedMapping: { contactName: 0, company: 1, email: 2 },
          missingFields: ["phone", "designation", "roleCategory", "city", "state", "industry", "sourceFile"],
          unmappedColumns: [],
          duplicateHeaders: [],
          importable: true,
        },
        {
          name: "Master Summary",
          headerRowNumber: null,
          headers: [],
          approxDataRowCount: 0,
          suggestedMapping: {},
          missingFields: [],
          unmappedColumns: [],
          duplicateHeaders: [],
          importable: false,
        },
      ],
    },
  ],
};

const previewSummary: ImportPreviewSummary = {
  sheets: [
    {
      fileId: "file-1",
      originalFilename: "leads.xlsx",
      sheetName: "Sheet1",
      totalRows: 100,
      validRows: 95,
      invalidRows: 5,
      duplicateExistingRows: 2,
      duplicateInFileRows: 1,
      rowsWithInvalidEmailFormat: 3,
      blankFieldCounts: { phone: 50 },
      willImportRows: 92,
    },
  ],
  totals: {
    totalRows: 100,
    validRows: 95,
    invalidRows: 5,
    duplicateExistingRows: 2,
    duplicateInFileRows: 1,
    rowsWithInvalidEmailFormat: 3,
    willImportRows: 92,
  },
  sampleRecords: [],
  sampleErrors: [],
};

describe("useImportWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts on the upload step", () => {
    const { result } = renderHook(() => useImportWizard());
    expect(result.current.step).toBe("upload");
  });

  it("uploads a file, populates worksheets from suggestedMapping, and advances to mapping", async () => {
    mockedApi.uploadImportFiles.mockResolvedValue(uploadResponse);
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "leads.xlsx")]);
    });

    expect(result.current.step).toBe("mapping");
    expect(result.current.stagingId).toBe("staging-1");
    expect(result.current.files).toHaveLength(1);
    const sheet1 = result.current.files[0].worksheets.find((w) => w.name === "Sheet1")!;
    expect(sheet1.selected).toBe(true);
    expect(sheet1.fieldColumns.contactName).toBe(0);
    expect(sheet1.fieldColumns.phone).toBeNull();

    // A worksheet with no detected header row is not importable and starts unselected.
    const summarySheet = result.current.files[0].worksheets.find((w) => w.name === "Master Summary")!;
    expect(summarySheet.importable).toBe(false);
    expect(summarySheet.selected).toBe(false);
  });

  it("surfaces a backend error on upload failure and stays on the upload step", async () => {
    mockedApi.uploadImportFiles.mockRejectedValue(new Error("Unsupported file type"));
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "bad.txt")]);
    });

    expect(result.current.step).toBe("upload");
    expect(result.current.uploadError).toBe("Unsupported file type");
  });

  it("excludes non-importable worksheets from selections sent to preview", async () => {
    mockedApi.uploadImportFiles.mockResolvedValue(uploadResponse);
    mockedApi.previewImport.mockResolvedValue({ digest: "digest-1", summary: previewSummary });
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "leads.xlsx")]);
    });
    await act(async () => {
      await result.current.runPreview();
    });

    expect(mockedApi.previewImport).toHaveBeenCalledWith("staging-1", [
      expect.objectContaining({ sheetName: "Sheet1" }),
    ]);
    expect(result.current.step).toBe("summary");
    expect(result.current.preview?.totals.willImportRows).toBe(92);
  });

  it("marks the preview stale after a mapping edit, requiring re-preview", async () => {
    mockedApi.uploadImportFiles.mockResolvedValue(uploadResponse);
    mockedApi.previewImport.mockResolvedValue({ digest: "digest-1", summary: previewSummary });
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "leads.xlsx")]);
    });
    await act(async () => {
      await result.current.runPreview();
    });
    expect(result.current.isStale).toBe(false);

    act(() => {
      result.current.updateMapping("file-1", "Sheet1", "phone", 0);
    });
    expect(result.current.isStale).toBe(true);

    await act(async () => {
      await result.current.runPreview();
    });
    expect(result.current.isStale).toBe(false);
  });

  it("does not call commitImport until confirmCommit is invoked (confirm-before-commit gate)", async () => {
    mockedApi.uploadImportFiles.mockResolvedValue(uploadResponse);
    mockedApi.previewImport.mockResolvedValue({ digest: "digest-1", summary: previewSummary });
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "leads.xlsx")]);
    });
    await act(async () => {
      await result.current.runPreview();
    });

    act(() => {
      result.current.requestCommit();
    });
    expect(result.current.confirmOpen).toBe(true);
    expect(mockedApi.commitImport).not.toHaveBeenCalled();

    mockedApi.commitImport.mockResolvedValue({
      imported: 92,
      skippedDuplicates: 3,
      invalidRows: 5,
      failedRows: 0,
      aborted: false,
      abortReason: null,
      errorRowCount: 5,
    });

    await act(async () => {
      await result.current.confirmCommit();
    });

    expect(mockedApi.commitImport).toHaveBeenCalledWith("staging-1", "digest-1");
    expect(result.current.step).toBe("result");
    expect(result.current.commitResult?.imported).toBe(92);
  });

  it("surfaces a commit error without advancing to the result step", async () => {
    mockedApi.uploadImportFiles.mockResolvedValue(uploadResponse);
    mockedApi.previewImport.mockResolvedValue({ digest: "digest-1", summary: previewSummary });
    mockedApi.commitImport.mockRejectedValue(new Error("This import selection has changed since it was last previewed."));
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "leads.xlsx")]);
    });
    await act(async () => {
      await result.current.runPreview();
    });
    await act(async () => {
      await result.current.confirmCommit();
    });

    expect(result.current.step).toBe("summary");
    expect(result.current.commitError).toMatch(/changed since it was last previewed/);
  });

  it("deletes staging and resets all state when cancel is confirmed", async () => {
    mockedApi.uploadImportFiles.mockResolvedValue(uploadResponse);
    mockedApi.cancelImport.mockResolvedValue(undefined);
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "leads.xlsx")]);
    });

    act(() => {
      result.current.requestCancel();
    });
    expect(result.current.cancelOpen).toBe(true);

    await act(async () => {
      await result.current.confirmCancel();
    });

    expect(mockedApi.cancelImport).toHaveBeenCalledWith("staging-1");
    expect(result.current.step).toBe("upload");
    expect(result.current.stagingId).toBeNull();
    expect(result.current.files).toHaveLength(0);
    await waitFor(() => expect(result.current.cancelOpen).toBe(false));
  });

  // --- Regression: "Master Summary"-style sheets (real header row, but zero
  // canonical fields recognized) must default to excluded, distinct from a
  // sheet that has no header row at all (importable: false, covered above). ---

  const summaryLikeUploadResponse: { stagingId: string; files: UploadedFileDto[] } = {
    stagingId: "staging-2",
    files: [
      {
        fileId: "file-1",
        originalFilename: "stampsize_import_qa_tricky.xlsx",
        worksheets: [
          {
            name: "Master Summary",
            headerRowNumber: 3,
            headers: ["Total records", "60"],
            approxDataRowCount: 1,
            suggestedMapping: {},
            missingFields: ["company", "contactName", "designation", "roleCategory", "email", "phone", "city", "state", "industry", "sourceFile"],
            unmappedColumns: [
              { index: 0, header: "Total records" },
              { index: 1, header: "60" },
            ],
            duplicateHeaders: [],
            importable: true,
          },
          {
            name: "Directors",
            headerRowNumber: 1,
            headers: ["Company", "Contact Name", "Designation", "Role Category", "Email", "Mobile / Phone", "City", "State", "Industry", "Source File"],
            approxDataRowCount: 13,
            suggestedMapping: { company: 0, contactName: 1, designation: 2, roleCategory: 3, email: 4, phone: 5, city: 6, state: 7, industry: 8, sourceFile: 9 },
            missingFields: [],
            unmappedColumns: [],
            duplicateHeaders: [],
            importable: true,
          },
        ],
      },
    ],
  };

  it("a worksheet with a real header row but zero auto-detected canonical fields (e.g. Master Summary) starts unselected, unlike a fully-mapped sheet", async () => {
    mockedApi.uploadImportFiles.mockResolvedValue(summaryLikeUploadResponse);
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "stampsize_import_qa_tricky.xlsx")]);
    });

    const summarySheet = result.current.files[0].worksheets.find((w) => w.name === "Master Summary")!;
    expect(summarySheet.importable).toBe(true); // it DOES have a detected header row, unlike the no-header-row case
    expect(summarySheet.selected).toBe(false); // but zero canonical fields matched, so it's excluded by default

    const directors = result.current.files[0].worksheets.find((w) => w.name === "Directors")!;
    expect(directors.selected).toBe(true);
  });

  it("excludes a zero-mapped summary sheet from selections/preview even when a normal sheet is also present", async () => {
    mockedApi.uploadImportFiles.mockResolvedValue(summaryLikeUploadResponse);
    mockedApi.previewImport.mockResolvedValue({ digest: "digest-2", summary: previewSummary });
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "stampsize_import_qa_tricky.xlsx")]);
    });
    await act(async () => {
      await result.current.runPreview();
    });

    expect(mockedApi.previewImport).toHaveBeenCalledWith("staging-2", [expect.objectContaining({ sheetName: "Directors" })]);
    const sentSheetNames = (mockedApi.previewImport.mock.calls[0][1] as { sheetName: string }[]).map((s) => s.sheetName);
    expect(sentSheetNames).not.toContain("Master Summary");
  });

  // Regression: the REAL production "Master Summary" sheet from
  // Master Contact Database.xlsx, captured verbatim from an actual upload
  // response during the production-workbook preflight. Unlike the dummy QA
  // file's Master Summary (zero fields matched), this one coincidentally
  // matches ONE optional field ("Source File" -> sourceFile), so
  // missingFields has length 9, not 10 — the sheet this task exists to fix
  // exclusion for.
  const realMasterSummaryUploadResponse: { stagingId: string; files: UploadedFileDto[] } = {
    stagingId: "staging-real-prod",
    files: [
      {
        fileId: "file-1",
        originalFilename: "Master Contact Database.xlsx",
        worksheets: [
          {
            name: "Master Summary",
            headerRowNumber: 5,
            headers: ["Sheet Name", "Role(s)", "Records", "With Email", "With Mobile/Phone", "Unique Companies", "With Industry Tag", "Source File"],
            approxDataRowCount: 995,
            suggestedMapping: { sourceFile: 7 },
            missingFields: ["company", "contactName", "designation", "roleCategory", "email", "phone", "city", "state", "industry"],
            unmappedColumns: [
              { index: 0, header: "Sheet Name" },
              { index: 1, header: "Role(s)" },
              { index: 2, header: "Records" },
              { index: 3, header: "With Email" },
              { index: 4, header: "With Mobile/Phone" },
              { index: 5, header: "Unique Companies" },
              { index: 6, header: "With Industry Tag" },
            ],
            duplicateHeaders: [],
            importable: true,
          },
          {
            name: "Chairmen",
            headerRowNumber: 1,
            headers: ["Company", "Contact Name", "Designation", "Role Category", "Email", "Mobile / Phone", "City", "State", "Industry", "Source File"],
            approxDataRowCount: 14803,
            suggestedMapping: { company: 0, contactName: 1, designation: 2, roleCategory: 3, email: 4, phone: 5, city: 6, state: 7, industry: 8, sourceFile: 9 },
            missingFields: [],
            unmappedColumns: [],
            duplicateHeaders: [],
            importable: true,
          },
        ],
      },
    ],
  };

  it("excludes the REAL Master Contact Database.xlsx 'Master Summary' rollup sheet by default, despite its one coincidental optional-field match", async () => {
    mockedApi.uploadImportFiles.mockResolvedValue(realMasterSummaryUploadResponse);
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "Master Contact Database.xlsx")]);
    });

    const summarySheet = result.current.files[0].worksheets.find((w) => w.name === "Master Summary")!;
    expect(summarySheet.importable).toBe(true);
    expect(summarySheet.selected).toBe(false); // excluded despite the "Source File" coincidental match

    const chairmen = result.current.files[0].worksheets.find((w) => w.name === "Chairmen")!;
    expect(chairmen.selected).toBe(true); // a genuine, fully-mapped data sheet must NOT be excluded
  });

  it("excludes the real Master Summary sheet from preview selections, alongside a genuine data sheet that is included", async () => {
    mockedApi.uploadImportFiles.mockResolvedValue(realMasterSummaryUploadResponse);
    mockedApi.previewImport.mockResolvedValue({ digest: "digest-real-prod", summary: previewSummary });
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "Master Contact Database.xlsx")]);
    });
    await act(async () => {
      await result.current.runPreview();
    });

    const sentSheetNames = (mockedApi.previewImport.mock.calls[0][1] as { sheetName: string }[]).map((s) => s.sheetName);
    expect(sentSheetNames).toEqual(["Chairmen"]);
    expect(sentSheetNames).not.toContain("Master Summary");
  });

  it("shuffled header order still populates fieldColumns correctly for every canonical field", async () => {
    const shuffledResponse: { stagingId: string; files: UploadedFileDto[] } = {
      stagingId: "staging-3",
      files: [
        {
          fileId: "file-1",
          originalFilename: "stampsize_import_qa_tricky.xlsx",
          worksheets: [
            {
              name: "Shuffled Headers",
              headerRowNumber: 1,
              headers: ["Email", "Company", "City", "Contact Name", "Mobile / Phone", "Designation", "State", "Industry", "Role Category", "Source File"],
              approxDataRowCount: 3,
              suggestedMapping: { email: 0, company: 1, city: 2, contactName: 3, phone: 4, designation: 5, state: 6, industry: 7, roleCategory: 8, sourceFile: 9 },
              missingFields: [],
              unmappedColumns: [],
              duplicateHeaders: [],
              importable: true,
            },
          ],
        },
      ],
    };
    mockedApi.uploadImportFiles.mockResolvedValue(shuffledResponse);
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "stampsize_import_qa_tricky.xlsx")]);
    });

    const sheet = result.current.files[0].worksheets[0];
    expect(sheet.selected).toBe(true);
    expect(sheet.fieldColumns).toEqual({
      email: 0,
      company: 1,
      city: 2,
      contactName: 3,
      phone: 4,
      designation: 5,
      state: 6,
      industry: 7,
      roleCategory: 8,
      sourceFile: 9,
    });
  });

  it("resets fully via reset() (used by 'Import another file')", async () => {
    mockedApi.uploadImportFiles.mockResolvedValue(uploadResponse);
    mockedApi.previewImport.mockResolvedValue({ digest: "digest-1", summary: previewSummary });
    mockedApi.commitImport.mockResolvedValue({
      imported: 92,
      skippedDuplicates: 3,
      invalidRows: 5,
      failedRows: 0,
      aborted: false,
      abortReason: null,
      errorRowCount: 5,
    });
    const { result } = renderHook(() => useImportWizard());

    await act(async () => {
      await result.current.upload([new File(["x"], "leads.xlsx")]);
    });
    await act(async () => {
      await result.current.runPreview();
    });
    await act(async () => {
      await result.current.confirmCommit();
    });
    expect(result.current.step).toBe("result");

    act(() => {
      result.current.reset();
    });

    expect(result.current.step).toBe("upload");
    expect(result.current.commitResult).toBeNull();
    expect(result.current.preview).toBeNull();
  });
});
