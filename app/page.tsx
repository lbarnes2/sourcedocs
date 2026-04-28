import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-landing">
      <header className="app-header home-landing-header">
        <h1>Event Collateral</h1>
        <p className="app-tagline">
          Choose a tool: banqueting documents from guest data, buffet menus with allergen outputs, or directional event
          signage from venue profiles. Manage all logos in one shared logo library.
        </p>
      </header>

      <div className="home-landing-grid">
        <Link className="home-landing-card" href="/banqueting">
          <span className="home-landing-card-title">Generate Banqueting Documents</span>
          <span className="home-landing-card-desc">
            Table plans, place cards, menu booklets, service plans, and floorplans from client data.
          </span>
        </Link>
        <Link className="home-landing-card home-landing-card--buffet" href="/buffet-menu">
          <span className="home-landing-card-title">Generate Buffet Menus</span>
          <span className="home-landing-card-desc">
            Display menu, allergen matrix, and buffet label sheets. Save drafts to the cloud.
          </span>
        </Link>
        <Link className="home-landing-card home-landing-card--signage" href="/signage">
          <span className="home-landing-card-title">Generate Event Signage</span>
          <span className="home-landing-card-desc">
            Sign packs for venues. Directional signage, ad-hoc sign generator.
          </span>
        </Link>
        <Link className="home-landing-card" href="/floorplans">
          <span className="home-landing-card-title">Floorplans Tool</span>
          <span className="home-landing-card-desc">
            Build custom floorplans with draggable tables, shapes, labels, and printable outputs.
          </span>
        </Link>
        <Link className="home-landing-card home-landing-card--logos" href="/logo-library">
          <span className="home-landing-card-title">Logo Library</span>
          <span className="home-landing-card-desc">
            Upload, rename, and delete venue and client logos used across all tools.
          </span>
        </Link>
      </div>
    </main>
  );
}
