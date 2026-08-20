"use client";

import { useRef, useState } from "react";

type Preview = {
  cards: { total: number; new: number };
  transactions: { total: number; new: number; duplicates: number };
  cardPurchases: {
    single: number;
    installmentGroups: number;
    new: number;
    duplicates: number;
  };
  budgets: { total: number; new: number };
  ignoredDebts: number;
  warnings: {
    invalidAmounts: number;
    negativeAdjustments: number;
    partialGroups: number;
  };
};

type Report = {
  cards: number;
  transactions: number;
  cardPurchases: number;
  budgets: number;
  duplicates: number;
  ignored: number;
  ignoredDebts: number;
};

export default function ImportBackupModal({
  open,
  onClose,
  onImported,
  onNotice,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [backup, setBackup] = useState<unknown>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function chooseFile(file?: File) {
    if (!file) return;
    if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".json")) {
      onNotice("Selecione um arquivo de backup no formato JSON.");
      return;
    }
    if (file.size > 5_000_000) {
      onNotice("O arquivo deve ter no máximo 5 MB.");
      return;
    }
    setBusy(true);
    setPreview(null);
    setReport(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const response = await fetch("/api/import/finance-backup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "preview", backup: parsed }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setFileName(file.name);
      setBackup(parsed);
      setPreview(body.preview);
    } catch (error) {
      setBackup(null);
      onNotice(
        error instanceof SyntaxError
          ? "O arquivo JSON está corrompido ou incompleto."
          : error instanceof Error
            ? error.message
            : "Não foi possível analisar o backup.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!backup || !preview) return;
    setBusy(true);
    try {
      const response = await fetch("/api/import/finance-backup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "import", backup }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setReport(body.report);
      await onImported();
      onNotice("Backup importado com segurança.");
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir a importação.",
      );
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    setFileName("");
    setBackup(null);
    setPreview(null);
    setReport(null);
    onClose();
  }

  return (
    <div className="modal-backdrop import-backdrop" role="presentation">
      <div
        className="modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <button
          className="modal-close"
          onClick={close}
          aria-label="Fechar importação"
        >
          ×
        </button>
        <p className="eyebrow">MIGRAÇÃO SEGURA</p>
        <h2 id="import-title">Importar backup financeiro</h2>
        <p>
          Cartões, lançamentos, compras parceladas e orçamentos serão
          aproveitados. A seção antiga de dívidas será ignorada.
        </p>

        {!preview && !report && (
          <button
            className="import-dropzone"
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <span className="import-file-icon">⇧</span>
            <strong>
              {busy ? "Analisando o backup…" : "Selecionar arquivo JSON"}
            </strong>
            <small>O arquivo será analisado antes de qualquer alteração.</small>
          </button>
        )}
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />

        {preview && !report && (
          <>
            <div className="import-file-name">
              <span>✓</span>
              <div>
                <strong>{fileName}</strong>
                <small>Backup reconhecido</small>
              </div>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                Trocar
              </button>
            </div>
            <div className="import-preview-grid">
              <div>
                <span>Cartões</span>
                <strong>{preview.cards.new}</strong>
                <small>de {preview.cards.total} novos</small>
              </div>
              <div>
                <span>Lançamentos</span>
                <strong>{preview.transactions.new}</strong>
                <small>prontos para importar</small>
              </div>
              <div>
                <span>Compras no cartão</span>
                <strong>{preview.cardPurchases.new}</strong>
                <small>
                  {preview.cardPurchases.installmentGroups} parcelamentos
                </small>
              </div>
              <div>
                <span>Orçamentos</span>
                <strong>{preview.budgets.new}</strong>
                <small>de {preview.budgets.total} novos</small>
              </div>
            </div>
            <div className="import-rules">
              <p>
                <span>✓</span> Dívidas serão recriadas somente pelas compras
                parceladas.
              </p>
              <p>
                <span>✓</span> Parcelamentos quitados continuarão visíveis com
                progresso completo.
              </p>
              <p>
                <span>✓</span>{" "}
                {preview.transactions.duplicates +
                  preview.cardPurchases.duplicates}{" "}
                registros já importados não serão duplicados.
              </p>
              {preview.warnings.partialGroups > 0 && (
                <p>
                  <span>i</span> {preview.warnings.partialGroups} parcelamentos
                  incompletos serão reconstruídos pelo histórico disponível.
                </p>
              )}
              {preview.ignoredDebts > 0 && (
                <p>
                  <span>i</span> {preview.ignoredDebts} registros da antiga
                  seção Dívidas serão ignorados.
                </p>
              )}
            </div>
            <div className="modal-actions import-actions">
              <button type="button" onClick={close} disabled={busy}>
                Cancelar
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => void runImport()}
                disabled={busy}
              >
                {busy ? "Importando…" : "Confirmar importação"}
              </button>
            </div>
          </>
        )}

        {report && (
          <div className="import-result">
            <div className="import-success">✓</div>
            <h3>Importação concluída</h3>
            <p>Seus dados antigos já foram organizados no Nexo.</p>
            <div className="import-result-list">
              <span>
                <strong>{report.cards}</strong> cartões novos
              </span>
              <span>
                <strong>{report.transactions}</strong> lançamentos
              </span>
              <span>
                <strong>{report.cardPurchases}</strong> compras de cartão
              </span>
              <span>
                <strong>{report.budgets}</strong> orçamentos
              </span>
              <span>
                <strong>{report.duplicates}</strong> duplicidades evitadas
              </span>
              <span>
                <strong>{report.ignoredDebts}</strong> dívidas antigas ignoradas
              </span>
            </div>
            <button
              className="primary import-finish"
              type="button"
              onClick={close}
            >
              Concluir
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
