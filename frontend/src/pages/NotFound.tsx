import { Home, SearchX } from "lucide-react";
import { Link } from "react-router-dom";

export default function NotFound() {
  return <main className="not-found"><span className="not-found-icon"><SearchX size={30} /></span><span className="eyebrow">ERROR 404</span><h1>That page is unavailable.</h1><p>The workspace link may have moved. Return to the home page to continue.</p><Link className="primary-button" to="/"><Home size={17} /> Back to home</Link></main>;
}
