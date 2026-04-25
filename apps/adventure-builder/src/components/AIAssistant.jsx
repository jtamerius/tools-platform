import { useState, useRef, useEffect } from 'react';
import { requestAssist } from '../services/api';
import './AIAssistant.css';

export default function AIAssistant({ currentPage, story }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const buildContext = () => {
    const parts = [];
    if (story?.title) parts.push(`Story: ${story.title}`);
    if (story?.description) parts.push(`Description: ${story.description}`);
    if (currentPage?.title) parts.push(`\nCurrent page: ${currentPage.title}`);
    if (currentPage?.content) parts.push(`Content: ${currentPage.content}`);
    return parts.join('\n').slice(0, 8000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: prompt }]);
    setLoading(true);
    try {
      const { suggestion } = await requestAssist(buildContext(), prompt);
      setMessages(prev => [...prev, { role: 'assistant', content: suggestion }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'error', content: err.message }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-root">
      <div className="ai-header">AI Assistant</div>
      <div className="ai-messages">
        {messages.length === 0 && (
          <p className="ai-hint">Ask for writing help, suggestions, or feedback on your current page.</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-msg ai-msg-${msg.role}`}>
            <span className="ai-msg-role">{msg.role === 'user' ? 'You' : msg.role === 'error' ? 'Error' : 'AI'}</span>
            <p className="ai-msg-content">{msg.content}</p>
          </div>
        ))}
        {loading && (
          <div className="ai-msg ai-msg-assistant ai-loading">
            <span className="ai-msg-role">AI</span>
            <p className="ai-msg-content">Thinking…</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form className="ai-form" onSubmit={handleSubmit}>
        <textarea
          className="ai-input"
          placeholder="Ask the AI…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
          maxLength={2000}
          rows={3}
        />
        <button className="ai-send" type="submit" disabled={loading || !input.trim()}>
          {loading ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
