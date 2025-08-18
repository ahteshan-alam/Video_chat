import './join.css'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
function Join() {
    const navigate = useNavigate()
    let [formData, setFormData] = useState({ username: "", room: "" })
    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.id]: e.target.value })
    }

    const handleSubmit = (e) => {
        e.preventDefault()
        navigate("/home", { state: { formData } })
        console.log("submit request", formData)
    }
    return (
        <div className="join">
            <form onSubmit={handleSubmit}>
                <label htmlFor="username">username</label>
                <input type="text" id="username" placeholder="enter username" onChange={handleChange} value={formData.username} required />
                <label htmlFor="roomId">roomId</label>
                <input type="text" id="room" placeholder="enter roomId" onChange={handleChange} value={formData.room} required />
                <button type='submit'>enter</button>
            </form>
        </div>
    );
}

export default Join;