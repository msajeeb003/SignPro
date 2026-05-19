import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { documents } from '../services/api.js';

export default function UploadPage() {
    const navigate = useNavigate();
    const [file, setFile] = useState(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [progress, setProgress] = useState(0);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);

    const onSubmit = async (e) => {
        e.preventDefault();
        if (!file) return;
        setError(null);
        setUploading(true);
        try {
            const result = await documents.upload(file, {
                title: title || file.name,
                description,
                onProgress: (event) => {
                    if (event.total) {
                        setProgress(Math.round((event.loaded / event.total) * 100));
                    }
                }
            });
            navigate(`/documents/${result.document.id}`);
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="page">
            <h1>Upload Document</h1>
            <form onSubmit={onSubmit} className="upload-form">
                <label>Document file (PDF or DOCX, max 25MB)
                    <input type="file"
                        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={e => setFile(e.target.files?.[0] || null)} required />
                </label>
                <label>Title
                    <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                        placeholder={file?.name || 'My document'} />
                </label>
                <label>Description (optional)
                    <textarea value={description} onChange={e => setDescription(e.target.value)} />
                </label>
                {uploading && progress > 0 && (
                    <div className="progress">
                        <div className="progress-bar" style={{ width: `${progress}%` }} />
                        <span>{progress}%</span>
                    </div>
                )}
                {error && <div className="error">{error}</div>}
                <button type="submit" disabled={!file || uploading} className="btn btn-primary">
                    {uploading ? 'Uploading...' : 'Upload & Parse'}
                </button>
            </form>
        </div>
    );
}
