import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { BookingProvider } from "./context/BookingContext";
import { FeedbackProvider } from "./context/FeedbackContext";
import "./App.css";

createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter><AuthProvider><BookingProvider><FeedbackProvider><App /></FeedbackProvider></BookingProvider></AuthProvider></BrowserRouter></StrictMode>);
