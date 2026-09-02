import { BarChart3, FileUp, Leaf } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type AdminSectionPageProps = { eyebrow: string; title: string; description: string; icon: LucideIcon };

export default function AdminSectionPage({ eyebrow, title, description, icon: Icon }: AdminSectionPageProps) {
  return <div className="page-frame admin-portal-page"><div className="page-intro"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></div><section className="section-placeholder"><span className="placeholder-icon"><Icon size={23} /></span><h2>{title} workspace</h2><p>This section is ready for its next operational capability.</p></section></div>;
}

export const analyticsSection = <AdminSectionPage eyebrow="ANALYTICS" title="Analytics" description="Track forecast quality and cafeteria performance." icon={BarChart3} />;
export const invoiceSection = <AdminSectionPage eyebrow="INVOICE SYNC" title="Invoice Sync" description="Keep source data ready for smarter recommendations." icon={FileUp} />;
export const esgSection = <AdminSectionPage eyebrow="ESG REPORT" title="ESG Report" description="Understand the environmental impact of better planning." icon={Leaf} />;
