import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportPage } from "../ImportPage";
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
  sampleRecords: [{ company: "Acme", fullName: "Jane Doe", title: null, roleCategory: null, email: "jane@acme.com", emailValid: true, phone: null, location: null, city: null, state: null, industry: null, sourceFile: null }],
  sampleErrors: [{ fileId: "file-1", originalFilename: "leads.xlsx", sheetName: "Sheet1", rowNumber: 12, reason: "Missing contact name" }],
};

async function uploadAFile(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(["dummy"], "leads.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
}

describe("ImportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the empty upload state with no data loaded", () => {
    render(<ImportPage />);
    expect(screen.getByText(/drag and drop a workbook/i)).toBeInTheDocument();
    expect(screen.queryByText(/preview import/i)).not.toBeInTheDocument();
  });

  it("shows an error state when upload fails and lets the user stay on upload", async () => {
    const user = userEvent.setup();
    mockedApi.uploadImportFiles.mockRejectedValue(new Error("Unsupported file type: \"bad.txt\""));
    render(<ImportPage />);

    await uploadAFile(user);

    await waitFor(() => expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument());
    expect(screen.getByText(/drag and drop a workbook/i)).toBeInTheDocument();
  });

  it("walks upload -> mapping -> preview summary -> confirm gate -> commit -> results", async () => {
    const user = userEvent.setup();
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

    render(<ImportPage />);
    await uploadAFile(user);

    // Mapping step: worksheet detected, core-field warnings surfaced.
    await waitFor(() => expect(screen.getByText("Sheet1")).toBeInTheDocument());
    expect(screen.getByText(/no column auto-detected for/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /preview import/i }));

    // Summary step: totals rendered from the mocked preview response.
    await waitFor(() => expect(screen.getByText(/confirm & import 92 leads/i)).toBeInTheDocument());
    expect(screen.getByText("100")).toBeInTheDocument(); // total rows stat tile

    // Commit must not fire until the confirm dialog is explicitly accepted.
    await user.click(screen.getByRole("button", { name: /confirm & import 92 leads/i }));
    expect(mockedApi.commitImport).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(mockedApi.commitImport).toHaveBeenCalledWith("staging-1", "digest-1"));

    // Result step.
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument());
    expect(screen.getByText(/download error report/i)).toBeInTheDocument();
  });

  it("cancels the import, deleting staging and returning to the upload step", async () => {
    const user = userEvent.setup();
    mockedApi.uploadImportFiles.mockResolvedValue(uploadResponse);
    mockedApi.cancelImport.mockResolvedValue(undefined);

    render(<ImportPage />);
    await uploadAFile(user);
    await waitFor(() => expect(screen.getByText("Sheet1")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /cancel import/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /discard/i }));

    await waitFor(() => expect(mockedApi.cancelImport).toHaveBeenCalledWith("staging-1"));
    await waitFor(() => expect(screen.getByText(/drag and drop a workbook/i)).toBeInTheDocument());
  });

  // --- Regression: exact canonical header matches must be visibly selected
  // in the mapping controls, not shown as blank/"Unmapped" despite the
  // underlying state (and the Review step) being correct. ---

  const exactHeaderResponse: { stagingId: string; files: UploadedFileDto[] } = {
    stagingId: "staging-exact",
    files: [
      {
        fileId: "file-1",
        originalFilename: "stampsize_import_qa_tricky.xlsx",
        worksheets: [
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

  it("exact canonical header matches are auto-selected AND visibly reflected in the mapping dropdown triggers", async () => {
    const user = userEvent.setup();
    mockedApi.uploadImportFiles.mockResolvedValue(exactHeaderResponse);
    render(<ImportPage />);

    await uploadAFile(user);
    await waitFor(() => expect(screen.getByText("Directors")).toBeInTheDocument());

    // Every field for this sheet was auto-detected, so no "Unmapped" badge
    // should appear anywhere on the card.
    expect(screen.queryByText("Unmapped")).not.toBeInTheDocument();

    // The dropdown triggers must show the actual mapped header text, not a
    // blank/placeholder — this is the state that Preview import and the
    // Review step both act on, so the control must display it too.
    expect(screen.getByRole("button", { name: /^company/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^contact name/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^email/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^mobile \/ phone/i })).toBeInTheDocument();
    expect(screen.queryByText("— Leave blank —")).not.toBeInTheDocument();
  });

  it("shuffled column headers are still correctly reflected in the mapping dropdowns, not shown as unmapped", async () => {
    const user = userEvent.setup();
    mockedApi.uploadImportFiles.mockResolvedValue({
      stagingId: "staging-shuffled",
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
    });
    render(<ImportPage />);

    await uploadAFile(user);
    await waitFor(() => expect(screen.getByText("Shuffled Headers")).toBeInTheDocument());

    expect(screen.queryByText("Unmapped")).not.toBeInTheDocument();
    // Company is at index 1 in this sheet (not 0) — the trigger must reflect
    // the real shuffled index, not just "whatever's first."
    expect(screen.getByRole("button", { name: /^company/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^contact name/i })).toBeInTheDocument();
  });

  // --- Regression: a summary/metadata sheet with zero recognized canonical
  // fields must be shown as clearly excluded, not as a normal mapping card
  // full of "Unmapped" badges, and must not count toward import totals. ---

  it("shows a zero-mapped summary sheet as excluded by default, alongside a normal sheet that maps and previews correctly", async () => {
    const user = userEvent.setup();
    mockedApi.uploadImportFiles.mockResolvedValue({
      stagingId: "staging-summary",
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
    });
    mockedApi.previewImport.mockResolvedValue({ digest: "digest-summary", summary: previewSummary });
    render(<ImportPage />);

    await uploadAFile(user);
    await waitFor(() => expect(screen.getByText("Master Summary")).toBeInTheDocument());

    expect(screen.getByText(/excluded — summary sheet/i)).toBeInTheDocument();
    // The excluded card shows no mapping grid — none of Master Summary's raw
    // column headers ("Total records", "60") should render as dropdown options/labels.
    expect(screen.queryByText("Total records")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /preview import/i }));

    await waitFor(() => expect(mockedApi.previewImport).toHaveBeenCalled());
    const sentSheetNames = (mockedApi.previewImport.mock.calls[0][1] as { sheetName: string }[]).map((s) => s.sheetName);
    expect(sentSheetNames).toEqual(["Directors"]);
    expect(sentSheetNames).not.toContain("Master Summary");
  });

  it("supports going back from summary to mapping without losing selections", async () => {
    const user = userEvent.setup();
    mockedApi.uploadImportFiles.mockResolvedValue(uploadResponse);
    mockedApi.previewImport.mockResolvedValue({ digest: "digest-1", summary: previewSummary });

    render(<ImportPage />);
    await uploadAFile(user);
    await waitFor(() => expect(screen.getByText("Sheet1")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /preview import/i }));
    await waitFor(() => expect(screen.getByText(/confirm & import 92 leads/i)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /back to mapping/i }));
    expect(screen.getByText("Sheet1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview import/i })).toBeInTheDocument();
  });
});
