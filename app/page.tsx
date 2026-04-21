import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-landing">
      <header className="app-header home-landing-header">
        <h1>Event Collateral</h1>
        <p className="app-tagline">
          Choose a tool: banqueting documents from guest data, or directional event signage from venue profiles.
        </p>
      </header>

      <div className="home-landing-grid">
        <Link className="home-landing-card" href="/banqueting">
          <span className="home-landing-card-title">Generate Banqueting Documents</span>
          <span className="home-landing-card-desc">
            Table plans, place cards, menu booklets, service plans, and floorplans from client data.
          </span>
        </Link>
        <Link className="home-landing-card home-landing-card--signage" href="/signage">
          <span className="home-landing-card-title">Generate Event Signage</span>
          <span className="home-landing-card-desc">
            Sign packs for venues. Directional signage, ad-hoc sign generator.
          </span>
        </Link>
      </div>
    </main>
  );
}
