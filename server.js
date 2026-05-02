const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG_FILE = "config.json";
const PRODUTOS_FILE = "produtos.json";

const USUARIO = "radahthales";
const SENHA = "870717";

// ===== SENHA DO PAINEL =====
function protegerPainel(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Pontta Print Painel"');
    return res.status(401).send("Acesso restrito.");
  }

  const base64 = auth.split(" ")[1];
  const [usuario, senha] = Buffer.from(base64, "base64").toString().split(":");

  if (usuario === USUARIO && senha === SENHA) {
    return next();
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="Pontta Print Painel"');
  return res.status(401).send("Usuário ou senha inválidos.");
}

app.use(express.json());

// protege tudo
app.use(protegerPainel);

app.use(express.static(path.join(__dirname, "public")));

function lerJSON(arquivo, padrao) {
  try {
    if (!fs.existsSync(arquivo)) {
      fs.writeFileSync(arquivo, JSON.stringify(padrao, null, 2));
      return padrao;
    }

    const conteudo = fs.readFileSync(arquivo, "utf8");

    if (!conteudo.trim()) {
      fs.writeFileSync(arquivo, JSON.stringify(padrao, null, 2));
      return padrao;
    }

    return JSON.parse(conteudo);
  } catch (err) {
    console.error(`Erro ao ler ${arquivo}:`, err);
    return padrao;
  }
}

function salvarJSON(arquivo, dados) {
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
}

const configPadrao = {
  produtos: ["Cartão de visita", "Panfletos"],
  materiais: ["Couchê 250g", "Couchê 300g"],
  tamanhos: ["87x47mm"],
  acabamentos: ["Laminação brilho"]
};

lerJSON(CONFIG_FILE, configPadrao);
lerJSON(PRODUTOS_FILE, []);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/config", (req, res) => {
  const config = lerJSON(CONFIG_FILE, configPadrao);
  res.json(config);
});

app.post("/config", (req, res) => {
  const { tipo, valor } = req.body;

  if (!tipo || !valor || !valor.trim()) {
    return res.status(400).json({ erro: "Dados inválidos" });
  }

  const config = lerJSON(CONFIG_FILE, configPadrao);

  if (!config[tipo]) {
    return res.status(400).json({ erro: "Tipo inválido" });
  }

  const valorLimpo = valor.trim();

  if (!config[tipo].includes(valorLimpo)) {
    config[tipo].push(valorLimpo);
  }

  salvarJSON(CONFIG_FILE, config);

  res.json({ ok: true });
});

app.get("/produtos", (req, res) => {
  const produtos = lerJSON(PRODUTOS_FILE, []);
  res.json(produtos);
});

app.post("/produtos", (req, res) => {
  const produtos = lerJSON(PRODUTOS_FILE, []);
  const novoProduto = req.body;

  if (!novoProduto.produto || !novoProduto.material || !novoProduto.tamanho || !novoProduto.acabamento) {
    return res.status(400).json({ erro: "Produto incompleto" });
  }

  produtos.push(novoProduto);
  salvarJSON(PRODUTOS_FILE, produtos);

  res.json({ ok: true });
});

app.put("/produtos/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const produtos = lerJSON(PRODUTOS_FILE, []);

  if (index < 0 || index >= produtos.length) {
    return res.status(400).json({ erro: "Índice inválido" });
  }

  produtos[index] = req.body;
  salvarJSON(PRODUTOS_FILE, produtos);

  res.json({ ok: true });
});

app.post("/produtos/:index/duplicar", (req, res) => {
  const index = parseInt(req.params.index);
  const produtos = lerJSON(PRODUTOS_FILE, []);

  if (index < 0 || index >= produtos.length) {
    return res.status(400).json({ erro: "Índice inválido" });
  }

  const copia = JSON.parse(JSON.stringify(produtos[index]));
  produtos.push(copia);

  salvarJSON(PRODUTOS_FILE, produtos);

  res.json({ ok: true });
});

app.delete("/produtos/:index", (req, res) => {
  const index = parseInt(req.params.index);
  const produtos = lerJSON(PRODUTOS_FILE, []);

  if (index < 0 || index >= produtos.length) {
    return res.status(400).json({ erro: "Índice inválido" });
  }

  produtos.splice(index, 1);
  salvarJSON(PRODUTOS_FILE, produtos);

  res.json({ ok: true });
});

app.get("/stats", (req, res) => {
  const produtos = lerJSON(PRODUTOS_FILE, []);

  const categorias = {};
  let totalPrecos = 0;
  let somaPrecos = 0;

  produtos.forEach(p => {
    categorias[p.produto] = (categorias[p.produto] || 0) + 1;

    if (Array.isArray(p.precos)) {
      p.precos.forEach(pr => {
        const valor = Number(String(pr.preco).replace(",", "."));
        if (!isNaN(valor)) {
          somaPrecos += valor;
          totalPrecos++;
        }
      });
    }
  });

  res.json({
    totalProdutos: produtos.length,
    totalCategorias: Object.keys(categorias).length,
    mediaPreco: totalPrecos > 0 ? somaPrecos / totalPrecos : 0,
    categorias
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});