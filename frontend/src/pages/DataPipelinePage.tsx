import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDown, CheckCircle2, Circle, Loader2, RefreshCw, ShieldCheck, Workflow } from "lucide-react";
import { useBookings } from "../context/BookingContext";
import { getPipeline, type PipelineView } from "../services/feedbackService";

/** Stage-by-stage view of Booking → … → Next prediction. */
export default function DataPipelinePage() {
  const { bookings } = useBookings();
  const [pipeline, setPipeline] = useState<PipelineView | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    setStatus("loading");
    getPipeline(bookings.length)
      .then(({ data }) => {
        if (!active) return;
        setPipeline(data);
        setStatus("ready");
      })
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
    };
  }, [bookings.length]);

  return (
    <div className="page-frame pipeline-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">DATA PIPELINE</span>
          <h1>The closed learning loop.</h1>
          <p>Every meal booked feeds the next forecast. Follow the data from booking to improved prediction.</p>
        </div>
        {pipeline && (
          <span className={`loop-pill${pipeline.loopClosed ? " is-closed" : ""}`}>
            <RefreshCw size={14} /> {pipeline.loopClosed ? "Loop closed" : "Loop warming up"}
          </span>
        )}
      </div>

      <p className="feedback-privacy-banner">
        <ShieldCheck size={14} /> Feedback enters the pipeline pseudonymised and is aggregated before any stage can read it. No stage
        below has access to an individual employee's response.
      </p>

      {status === "loading" && (
        <section className="section-placeholder">
          <Loader2 size={22} className="spin" />
          <h2>Tracing the pipeline…</h2>
        </section>
      )}

      {status === "error" && (
        <section className="section-placeholder">
          <span className="placeholder-icon">
            <Workflow size={23} />
          </span>
          <h2>Pipeline unavailable</h2>
          <p>Start the backend to see live stage metrics.</p>
        </section>
      )}

      {status === "ready" && pipeline && (
        <ol className="pipeline-flow">
          {pipeline.stages.map((stage, index) => (
            <motion.li
              key={stage.id}
              className={`pipeline-stage ${stage.status}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
            >
              <div className="pipeline-stage-card">
                <div className="pipeline-stage-head">
                  <span className="pipeline-order">{stage.order}</span>
                  <div>
                    <h2>{stage.name}</h2>
                    <span className="pipeline-owner">{stage.owner}</span>
                  </div>
                  <span className="pipeline-status" title={stage.status === "active" ? "Receiving data" : "Awaiting data"}>
                    {stage.status === "active" ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                  </span>
                </div>
                <p>{stage.description}</p>
                <div className="pipeline-metric">
                  <strong>
                    {stage.metric.value}
                    {stage.metric.unit === "%" ? "%" : stage.metric.unit === "x" ? "×" : ""}
                  </strong>
                  <small>{stage.metric.label}</small>
                </div>
                <dl className="pipeline-io">
                  <div>
                    <dt>In</dt>
                    <dd>{stage.input}</dd>
                  </div>
                  <div>
                    <dt>Out</dt>
                    <dd>{stage.output}</dd>
                  </div>
                  <div>
                    <dt>Where</dt>
                    <dd>
                      <code>{stage.store}</code>
                    </dd>
                  </div>
                </dl>
              </div>
              {index < pipeline.stages.length - 1 && (
                <span className="pipeline-connector" aria-hidden="true">
                  <ArrowDown size={16} />
                </span>
              )}
            </motion.li>
          ))}
        </ol>
      )}

      {status === "ready" && pipeline && (
        <aside className="pipeline-loopback">
          <RefreshCw size={18} />
          <span>
            <strong>Back to booking</strong>
            <small>
              The adjusted forecast sizes next week's service.
              {pipeline.lastSignalRefresh
                ? ` Signals last refreshed ${new Date(pipeline.lastSignalRefresh).toLocaleString()}.`
                : " No signals recorded yet."}
            </small>
          </span>
        </aside>
      )}
    </div>
  );
}
