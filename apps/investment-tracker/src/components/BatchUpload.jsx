import { useRef, useState, useCallback } from 'react';
import { uploadFiles } from '../services/api';
import './BatchUpload.css';

export default function BatchUpload({ onUploadComplete, inboundEmail }) {
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef();

  const copyEmail = () => {
    if (!inboundEmail) return;
    navigator.clipboard.writeText(inboundEmail).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const addFiles = useCallback((incoming) => {
    setFiles((prev) => [...prev, ...Array.from(incoming)]);
  }, []);

  const handleDrop = (e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); };
  const handleDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);
  const removeFile = (i) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const handleUpload = async () => {
    setUploading(true);
    setResults(null);
    try {
      const data = await uploadFiles(files);
      setResults(data.results);
      setFiles([]);
      if (onUploadComplete) onUploadComplete();
    } catch (err) {
      setResults([{ name: 'Upload failed', ok: false, error: err.message }]);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-wrap">
      {inboundEmail && (
        <div className="inbound-email">
          <span className="inbound-label">Forward statements to:</span>
          <code className="inbound-addr">{inboundEmail}</code>
          <button className="copy-btn" onClick={copyEmail}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      <div
        className={`drop-zone${dragging ? ' drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current.click()}
      >
        <p>Drag & drop email files here (<strong>.eml</strong>, <strong>.mbox</strong>, or mbox archives)</p>
        <p>or <span className="browse">browse</span></p>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {files.length > 0 && (
        <>
          <ul className="file-list">
            {files.map((f, i) => (
              <li key={i}><span>{f.name}</span><button onClick={() => removeFile(i)}>✕</button></li>
            ))}
          </ul>
          <div className="upload-actions">
            <button className="upload-btn" disabled={uploading} onClick={handleUpload}>
              {uploading ? 'Uploading…' : `Upload ${files.length} file${files.length > 1 ? 's' : ''}`}
            </button>
            <button className="clear-btn" onClick={() => setFiles([])}>Clear</button>
          </div>
        </>
      )}

      {results && (
        <div className="upload-results">
          <h3>Results — {results.filter((r) => r.ok).length}/{results.length} succeeded</h3>
          <ul className="file-list">
            {results.map((r, i) => (
              <li key={i} className={r.ok ? 'result-ok' : 'result-fail'}>
                <span>{r.name}</span>
                <span>{r.ok ? '✓' : r.error || 'failed'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
