import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { NAV_TOOLS } from "./components/navTools";

export default function HomePage() {
  return (
    <main className="page">
      <header className="page-header home-header">
        <div className="page-header-text">
          <h1>Event Collateral</h1>
          <p>Quick tools for the print jobs every event needs. Pick one to get started.</p>
        </div>
      </header>

      <div className="home-grid">
        {NAV_TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <Link
              key={tool.href}
              className="home-card"
              href={tool.href}
              style={{ ["--tool-color" as string]: tool.color }}
            >
              <span className="home-card-icon" aria-hidden>
                <Icon size={20} />
              </span>
              <span className="home-card-title">{tool.name}</span>
              <span className="home-card-desc">{tool.description}</span>
              <ArrowRight size={16} className="home-card-arrow" aria-hidden />
            </Link>
          );
        })}
      </div>
    </main>
  );
}
