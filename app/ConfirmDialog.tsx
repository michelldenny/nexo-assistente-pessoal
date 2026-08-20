export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="modal-backdrop system-dialog-backdrop"
      role="presentation"
      onMouseDown={onCancel}
    >
      <div
        className="system-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={`dialog-symbol ${danger ? "danger" : ""}`}>
          {danger ? "!" : "✓"}
        </div>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-message">{message}</p>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancelar</button>
          <button
            className={danger ? "dialog-danger" : "primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
