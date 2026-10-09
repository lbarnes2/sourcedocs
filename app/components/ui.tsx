"use client";

import { ChevronDown, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Compact page title row: title + optional description on the left, actions on the right. */
export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

type SectionProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  step?: number;
  children?: ReactNode;
  className?: string;
  /** When set, the section body can be collapsed; `summary` shows while collapsed. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  summary?: ReactNode;
  id?: string;
};

/** Card with a header row. Optional numbered step badge and collapse toggle. */
export function Section({
  title,
  description,
  actions,
  step,
  children,
  className,
  collapsible,
  defaultOpen = true,
  summary,
  id
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const isOpen = !collapsible || open;
  const heading = (
    <>
      {step != null ? <span className="step-badge">{step}</span> : null}
      <span className="card-title-text">{title}</span>
    </>
  );
  return (
    <section className={`card${className ? ` ${className}` : ""}`} id={id}>
      {title != null ? (
        <div className={`card-head${isOpen && children ? "" : " card-head--closed"}`}>
          <div className="card-head-text">
            {collapsible ? (
              <button
                type="button"
                className="card-title card-title--toggle"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => setOpen((o) => !o)}
              >
                {heading}
                <ChevronDown size={16} className={`card-chevron${open ? " card-chevron--open" : ""}`} aria-hidden />
              </button>
            ) : (
              <h2 className="card-title">{heading}</h2>
            )}
            {description && isOpen ? <p className="card-desc">{description}</p> : null}
            {summary && !isOpen ? <p className="card-desc">{summary}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children ? (
        <div className="card-body" id={bodyId} hidden={!isOpen}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Label + control + optional hint. Use `as="div"` when the control contains its own buttons. */
export function Field({
  label,
  hint,
  children,
  className,
  as = "label"
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "label" | "div";
}) {
  const Tag = as;
  return (
    <Tag className={`field${className ? ` ${className}` : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </Tag>
  );
}

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; title?: string };

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  "aria-label": ariaLabel,
  size
}: {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  "aria-label"?: string;
  size?: "sm";
}) {
  return (
    <div className={`segmented${size === "sm" ? " segmented--sm" : ""}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          disabled={disabled}
          className={value === option.value ? "segmented-item segmented-item--on" : "segmented-item"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  disabled
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="color-field">
      <span className="color-field-swatch" style={{ backgroundColor: value }}>
        <input type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      </span>
      <span className="color-field-text">
        <span className="color-field-label">{label}</span>
        <span className="color-field-hex">{value}</span>
      </span>
    </label>
  );
}

const CALLOUT_ICONS = { info: Info, warning: TriangleAlert, error: CircleAlert } as const;

export function Callout({
  tone = "info",
  children,
  onDismiss,
  className
}: {
  tone?: "info" | "warning" | "error";
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const Icon = CALLOUT_ICONS[tone];
  return (
    <div
      className={`callout callout--${tone}${className ? ` ${className}` : ""}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon size={16} className="callout-icon" aria-hidden />
      <div className="callout-body">{children}</div>
      {onDismiss ? (
        <button type="button" className="icon-btn icon-btn--sm" onClick={onDismiss} aria-label="Dismiss">
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

/** Inline "more options" disclosure built on <details>. */
export function Disclosure({
  label,
  children,
  defaultOpen,
  className
}: {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <details
      className={`disclosure${className ? ` ${className}` : ""}`}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <ChevronDown size={14} className="disclosure-chevron" aria-hidden />
        {label}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  "aria-label": ariaLabel
}: {
  value: T;
  tabs: ReadonlyArray<{ value: T; label: ReactNode; badge?: ReactNode }>;
  onChange: (value: T) => void;
  "aria-label"?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={value === tab.value ? "tab tab--on" : "tab"}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.badge != null ? <span className="tab-badge">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Checkbox styled as a switch, with a label and optional hint. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="switch-row">
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-text">
        <span>{label}</span>
        {hint ? <span className="field-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Centered dialog rendered in a portal; closes on Escape or backdrop click. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  size
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal modal--${size ?? "md"}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h3 id={titleId} className="modal-title">
            {title}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

/** Fixed bottom-right stack so errors stay visible however far down a long page you are. */
export function Toasts({ children }: { children: ReactNode }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {children}
    </div>
  );
}

/** Upload target: click or drop a file. */
export function Dropzone({
  accept,
  onFile,
  title,
  subtitle,
  icon,
  disabled
}: {
  accept: string;
  onFile: (file: File) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`dropzone${over ? " dropzone--over" : ""}${disabled ? " dropzone--disabled" : ""}`}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        // Ignore leave events fired when moving between the zone's own children.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
      {icon ? <span className="dropzone-icon">{icon}</span> : null}
      <span className="dropzone-text">
        <strong>{title}</strong>
        {subtitle ? <span className="text-muted">{subtitle}</span> : null}
      </span>
    </label>
  );
}
