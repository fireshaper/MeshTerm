import { Link } from "@tanstack/react-router";

export function NotFoundPage() {
  return (
    <section data-mt="not-found">
      <h1 data-mt="page-title">Page not found</h1>
      <Link to="/channels/$index" params={{ index: "0" }}>
        Back to channels
      </Link>
    </section>
  );
}
