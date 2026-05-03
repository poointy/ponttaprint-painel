require("dotenv").config();

const express = require("express");
const path = require("path");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== LOGIN =====
const USUARIO = "radahthales";
const SENHA = "870717";

function protegerPainel(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Painel"');
    return res.status(401).send("Acesso restrito.");
  }

  const base64 = auth.split(" ")[1];
  const [usuario, senha] = Buffer.from(base64, "base64").toString().split(":");

  if (usuario === USUARIO && senha === SENHA) return next();

  return res.status(401).send("Login inválido");
}

app.use(express.json());
app.use(protegerPainel);
app.use(express.static(path.join(__dirname, "public")));

// ===== WOO =====
async function wc(endpoint) {
  const url = `${process.env.WC_URL}/wp-json/wc/v3${endpoint}`;

  const res = await axios.get(url, {
    params: {
      consumer_key: process.env.WC_CONSUMER_KEY,
      consumer_secret: process.env.WC_CONSUMER_SECRET
    }
  });

  return res.data;
}

// ===== TESTE =====
app.get("/teste-woo", async (req, res) => {
  try {
    const produtos = await wc("/products");

    res.json({
      ok: true,
      total: produtos.length,
      nomes: produtos.map(p => p.name)
    });
  } catch (err) {
    console.log("ERRO:", err.response?.data || err.message);

    res.status(500).json({
      ok: false,
      erro: err.response?.data || err.message
    });
  }
});

// ===== LISTAR =====
app.get("/produtos", async (req, res) => {
  try {
    const lista = await wc("/products");

    const formatado = lista.map((p, i) => ({
      produto: p.name,
      material: "WooCommerce",
      tamanho: "WooCommerce",
      acabamento: "WooCommerce",
      precos: [
        {
          quantidade: "1",
          preco: p.price || "0"
        }
      ],
      index: i
    }));

    res.json(formatado);
  } catch (err) {
    console.log("ERRO:", err.response?.data || err.message);
    res.status(500).json([]);
  }
});

// ===== START =====
app.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta " + PORT);
});