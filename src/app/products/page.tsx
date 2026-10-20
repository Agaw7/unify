
const products = [
  {
    name: "Starter Trading Simulation",
    description: "Learn how trading returns and losses work.",
    risk: "High",
  },
  {
    name: "Growth Trading Simulation",
    description: "Explore changing market performance.",
    risk: "High",
  },
];

export default function ProductsPage() {
  return (
    <main style={{
      background: "#0B1320",
      color: "white",
      minHeight: "100vh",
      padding: 40,
    }}>
      <h1>UNIFY Products</h1>
      {products.map(product => (
        <section
          key={product.name}
          style={{
            background: "#142238",
            padding: 20,
            borderRadius: 12,
            marginTop: 16,
          }}
        >
          <h2>{product.name}</h2>
          <p>{product.description}</p>
          <p>Risk Level: {product.risk}</p>
        </section>
      ))}
    </main>
  );
}
