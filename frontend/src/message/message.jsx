import './message.css';

function Message({ data, currUserId }) {
    const isOwn = data.userId === currUserId;
    const messageTime = new Date(data.time).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });

    return (
        <div className={`message-row ${isOwn ? 'own' : 'other'}`}>
            <div className="message-bubble">
                <div className="username">{data.username}</div>
                <div className="text">{data.message}</div>
                <div className="timestamp-container">
                    <span className="timestamp">{messageTime}</span>
                </div>
            </div>
        </div>
    );
}

export default Message;