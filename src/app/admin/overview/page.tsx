
export default function AdminOverviewPage() {
  return (
    <main style={{
      background: "#0B1320",
      color: "white",
      minHeight: "100vh",
      padding: 40,
    }}>
      <h1>UNIFY Admin Overview</h1>
      <p>Admin dashboard interface — setup in progress.</p>

      <section style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 16,
        marginTop: 24,
      }}>
        {[
          "Total Users",
          "Sandbox Deposits",
          "Sandbox Withdrawals",
          "Pending Reviews",
        ].map(item => (
          <div
            key={item}
            style={{
              background: "#142238",
              padding: 20,
              borderRadius: 12,
            }}
          >
            <p>{item}</p>
            <h2>—</h2>
          </div>
        ))}
      </section>
    </main>
  );
}
