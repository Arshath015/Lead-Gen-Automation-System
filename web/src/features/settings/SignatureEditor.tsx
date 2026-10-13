import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Minus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Indent,
  Outdent,
  Check,
  ImagePlus,
  Loader2,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { inputClass } from "../../components/ui/field";
import { cn } from "../../lib/cn";
import { api } from "../../api/client";
import { useToast } from "../../lib/toast";

const MAX_SIGNATURE_IMAGE_BYTES = 3 * 1024 * 1024;

// Extends the stock Image node with a data-signature-asset-id attribute that
// survives serialization to/from HTML. The server reads this attribute at
// send time (composeEmailBody in resendAdapter.ts) to swap the src for a
// cid: reference and attach the actual image bytes inline — a plain <img
// src="/api/signature-images/...">  would be unreachable from a recipient's
// mail client, since it points at this app's own local server.
//
// width/height are already part of the stock Image node's attributes
// (inherited via ...this.parent?.()) and are plain HTML attributes on the
// rendered <img> — not a CSS style — because sanitizeHtml.ts's allowed
// style properties don't include width/height, but its allowed img
// attributes already did (see server/src/email/sanitizeHtml.ts). That's also
// why the resize handles below persist correctly through save/sanitize/send:
// composeEmailBody's CID-rewrite only ever touches the src attribute of the
// matched <img> tag, leaving width/height exactly as authored.
const SignatureImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      "data-signature-asset-id": {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-signature-asset-id"),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes["data-signature-asset-id"] ? { "data-signature-asset-id": attributes["data-signature-asset-id"] } : {},
      },
    };
  },
});

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault(); // keep editor selection/focus while clicking the toolbar
        onClick();
      }}
      className={cn(
        "flex size-7 items-center justify-center rounded-lg text-gray-500 transition-colors",
        "hover:bg-gray-100 hover:text-ink disabled:pointer-events-none disabled:opacity-30",
        active && "bg-accent-50 text-accent-700"
      )}
    >
      {children}
    </button>
  );
}

interface Props {
  value: string;
  onSave: (html: string) => Promise<void>;
}

export function SignatureEditor({ value, onSave }: Props) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Regards,\nYour name" }),
      SignatureImage.configure({
        inline: false,
        // Tiptap's built-in resizable node view: drag any corner or edge
        // handle to set the image's displayed width/height. Aspect ratio is
        // always locked (alwaysPreserveAspectRatio) rather than only on
        // Shift, since a stretched/squashed signature logo has no legitimate
        // use here. Handles are hidden until the image is selected — styled
        // in index.css since the Image extension doesn't forward a
        // className option through to the resize view.
        resize: {
          enabled: true,
          directions: ["top", "right", "bottom", "left", "top-left", "top-right", "bottom-left", "bottom-right"],
          minWidth: 24,
          minHeight: 24,
          alwaysPreserveAspectRatio: true,
        },
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "signature-editor-content min-h-[140px] outline-none px-3.5 py-3 text-[13px] text-ink",
      },
    },
    onUpdate: () => setDirty(true),
  });

  async function handleImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !editor) return;

    if (file.size > MAX_SIGNATURE_IMAGE_BYTES) {
      toast.push({ variant: "error", title: "Image too large", description: "Max 3MB — resize or compress it first." });
      return;
    }

    setUploadingImage(true);
    try {
      const uploaded = await api.uploadSignatureImage(file);
      editor
        .chain()
        .focus()
        .setImage({ src: uploaded.url, alt: uploaded.filename, "data-signature-asset-id": uploaded.id } as never)
        .run();
      setDirty(true);
    } catch (err) {
      toast.push({ variant: "error", title: "Couldn't upload image", description: (err as Error).message });
    } finally {
      setUploadingImage(false);
    }
  }

  // Reload content if the saved value changes underneath us (e.g. after a
  // successful save resets the "dirty" baseline).
  useEffect(() => {
    if (editor && !dirty) {
      editor.commands.setContent(value || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return null;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(editor!.getHTML());
      setDirty(false);
    } catch {
      // caller already surfaces a toast; keep "dirty" so the user can retry
    } finally {
      setSaving(false);
    }
  }

  function applyLink() {
    if (linkUrl.trim()) {
      editor!.chain().focus().extendMarkRange("link").setLink({ href: linkUrl.trim() }).run();
    } else {
      editor!.chain().focus().unsetLink().run();
    }
    setLinkUrl("");
    setLinkPromptOpen(false);
  }

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border-subtle p-1.5">
        <select
          className="mr-1 rounded-lg border-0 bg-transparent px-1.5 py-1 text-[12.5px] font-medium text-gray-600 outline-none hover:bg-gray-100"
          value={
            editor.isActive("heading", { level: 1 })
              ? "h1"
              : editor.isActive("heading", { level: 2 })
              ? "h2"
              : editor.isActive("heading", { level: 3 })
              ? "h3"
              : "p"
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v === "p") editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
          }}
        >
          <option value="p">Normal text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>

        <div className="mx-1 h-4 w-px bg-border-subtle" />

        <ToolbarButton title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Link"
          active={editor.isActive("link")}
          onClick={() => {
            setLinkUrl(editor.getAttributes("link").href ?? "");
            setLinkPromptOpen((v) => !v);
          }}
        >
          <LinkIcon className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border-subtle" />

        <ToolbarButton title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <AlignLeft className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <AlignCenter className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <AlignRight className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border-subtle" />

        <ToolbarButton title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Indent" disabled={!editor.can().sinkListItem("listItem")} onClick={() => editor.chain().focus().sinkListItem("listItem").run()}>
          <Indent className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Outdent" disabled={!editor.can().liftListItem("listItem")} onClick={() => editor.chain().focus().liftListItem("listItem").run()}>
          <Outdent className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border-subtle" />

        <ToolbarButton title="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Separator" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border-subtle" />

        <ToolbarButton
          title="Insert image"
          disabled={uploadingImage}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadingImage ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
        </ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={handleImageSelected}
        />
      </div>

      {linkPromptOpen && (
        <div className="flex items-center gap-2 border-b border-border-subtle bg-gray-50 p-2">
          <input
            autoFocus
            className={inputClass + " h-8 flex-1 text-[12.5px]"}
            placeholder="https://example.com"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyLink()}
          />
          <Button size="sm" variant="primary" onClick={applyLink}>
            <Check className="size-3.5" />
          </Button>
        </div>
      )}
      <EditorContent editor={editor} />

      <div className="flex items-center justify-between border-t border-border-subtle px-3.5 py-2.5">
        <p className="text-[11px] text-gray-400">{dirty ? "Unsaved changes" : "Saved"}</p>
        <Button size="sm" variant="primary" onClick={handleSave} loading={saving} disabled={!dirty}>
          Save signature
        </Button>
      </div>
    </div>
  );
}
