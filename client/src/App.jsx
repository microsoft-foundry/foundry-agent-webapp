import { useState } from 'react';

function App() {
  const [message, setMessage] = useState('');
  const [conversation, setConversation] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!message.trim()) return;

    const userMessage = message.trim();
    setMessage('');
    setError(null);
    setLoading(true);

    // Add user message to conversation
    setConversation(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.reply || data.error || 'Failed to get response');
      }

      // Add AI response to conversation
      setConversation(prev => [...prev, { role: 'assistant', content: data.reply }]);

    } catch (err) {
      setError(err.message);
      console.error('Chat error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="container">
        <header>
          <h1>Mazhar AI</h1>
          <p>Simple, clean, no-nonsense AI chat</p>
        </header>

        <div className="chat-container">
          <div className="messages">
            {conversation.length === 0 && (
              <div className="empty-state">
                <p>Start a conversation by typing a message below</p>
              </div>
            )}

            {conversation.map((msg, index) => (
              <div key={index} className={`message ${msg.role}`}>
                <div className="message-label">
                  {msg.role === 'user' ? 'You' : 'Mazhar AI'}
                </div>
                <div className="message-content">{msg.content}</div>
              </div>
            ))}

            {loading && (
              <div className="message assistant">
                <div className="message-label">Mazhar AI</div>
                <div className="message-content loading">Thinking...</div>
              </div>
            )}
          </div>

          {error && (
            <div className="error">
              <strong>Error:</strong> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="input-form">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message..."
              disabled={loading}
              autoFocus
            />
            <button type="submit" disabled={loading || !message.trim()}>
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;
