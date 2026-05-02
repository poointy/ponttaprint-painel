require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CONFIG =====
const CONFIG_FILE = "config.json";

const WC_URL = process.env.WC_URL;
const WC_KEY = process.env.WC_CONSUMER_KEY;
const WC_SECRET = process.env.WC_CONSUMER_SECRET;

// ===== LOGIN =====
const USUARIO = "radahthales";
const SENHA = "870717";

function protegerPainel(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Pontta Print Painel"');
    return res.status(401).send("Acesso restrito.");
  }

  const base64 = auth.split(" ")[1];
  const [usuario, senha] = Buffer.from(base64, "base64").toString().split(":");

  if (usuario === USUARIO && senha === SENHA) return next();

  res.setHeader("WWW-Authenticate", 'Basic realm="Pontta Print Painel"');
  return res.status(401).send("Usuário ou senha inválidos.");
}

app.use(express.json());
app.use(protegerPainel);
app.use(express.static(path.join(__dirname, "public")));

// ===== JSON CONFIG =====
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
  } catch {
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

// ===== WOOCOMMERCE =====
async function wc(method, endpoint, data = null, extra = {}) {
  const url = `${WC_URL}/wp-json/wc/v3${endpoint}`;

  const res = await axios({
    method,
    url,
    params: {
      consumer_key: WC_KEY,
      consumer_secret: WC_SECRET,
      ...extra
    },
    data
  });

  return res.data;
}

// ===== UTIL =====
function limparPreco(valor) {
  if (!valor) return "0";
  return String(valor).replace("R$", "").replace(/\./g, "").replace(",", ".").trim();
}

function menorPreco(precos) {
  if (!Array.isArray(precos) || precos.length === 0) return "0";

  const nums = precos
    .map(p => Number(limparPreco(p.preco)))
    .filter(n => !isNaN(n));

  if (nums.length === 0) return "0";

  return String(Math.min(...nums).toFixed(2));
}

function montarDescricao(d) {
  return `
<p><strong>Produto:</strong> ${d.produto}</p>
<p><strong>Material:</strong> ${d.material}</p>
<p><strong>Tamanho:</strong> ${d.tamanho}</p>
<p><strong>Acabamento:</strong> ${d.acabamento}</p>

<h3>Preços cadastrados</h3>
<ul>
${(d.precos || []).map(p => `<li>${p.quantidade} unidades = R$ ${p.preco}</li>`).join("")}
</ul>

<p><em>Produto cadastrado pelo Painel Pontta Print.</em></p>
`;
}

function montarMetaData(d) {
  return [
    { key: "pontta_produto", value: d.produto },
    { key: "pontta_material", value: d.material },
    { key: "pontta_tamanho", value: d.tamanho },
    { key: "pontta_acabamento", value: d.acabamento },
    { key: "pontta_precos", value: d.precos || [] }
  ];
}

function montarProdutoSimples(d) {
  return {
    name: d.produto,
    type: "simple",
    status: "publish",
    catalog_visibility: "visible",
    regular_price: menorPreco(d.precos),
    description: montarDescricao(d),
    short_description: `<p>${d.material} | ${d.tamanho} | ${d.acabamento}</p>`,
    meta_data: montarMetaData(d)
  };
}

function montarProdutoVariavel(d) {
  const quantidades = (d.precos || [])
    .map(p => String(p.quantidade).trim())
    .filter(Boolean);

  return {
    name: d.produto,
    type: "variable",
    status: "publish",
    catalog_visibility: "visible",
    description: montarDescricao(d),
    short_description: `<p>${d.material} | ${d.tamanho} | ${d.acabamento}</p>`,
    attributes: [
      {
        name: "Quantidade",
        visible: true,
        variation: true,
        options: quantidades
      }
    ],
    meta_data: montarMetaData(d)
  };
}

async function criarVariacoes(produtoId, precos) {
  for (const item of precos || []) {
    const quantidade = String(item.quantidade || "").trim();
    const preco = limparPreco(item.preco);

    if (!quantidade || !preco) continue;

    await wc("post", `/products/${produtoId}/variations`, {
      regular_price: String(preco),
      attributes: [
        {
          name: "Quantidade",
          option: quantidade
        }
      ]
    });
  }
}

async function deletarVariacoes(produtoId) {
  try {
    const variacoes = await wc("get", `/products/${produtoId}/variations`, null, {
      per_page: 100
    });

    for (const variacao of variacoes) {
      await wc("delete", `/products/${produtoId}/variations/${variacao.id}`, null, {
        force: true
      });
    }
  } catch (err) {
    console.log("Erro ao deletar variações:", err.response?.data || err.message);
  }
}

function normalizarProdutoPainel(p, i) {
  const meta = {};

  (p.meta_data || []).forEach(m => {
    meta[m.key] = m.value;
  });

  let precos = meta.pontta_precos || [];

  if (!Array.isArray(precos) || precos.length === 0) {
    precos = [
      {
        quantidade: "1",
        preco: p.price || p.regular_price || "0"
      }
    ];
  }

  return {
    produto: meta.pontta_produto || p.name || "",
    material: meta.pontta_material || "",
    tamanho: meta.pontta_tamanho || "",
    acabamento: meta.pontta_acabamento || "",
    precos,
    index: i,
    wooId: p.id,
    tipoWoo: p.type,
    permalink: p.permalink || ""
  };
}

// ===== ROTAS =====

// Página
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Config
app.get("/config", (req, res) => {
  res.json(lerJSON(CONFIG_FILE, configPadrao));
});

app.post("/config", (req, res) => {
  const { tipo, valor } = req.body;
  const config = lerJSON(CONFIG_FILE, configPadrao);

  if (!tipo || !valor) {
    return res.status(400).json({ erro: "Dados inválidos" });
  }

  if (!config[tipo]) {
    return res.status(400).json({ erro: "Tipo inválido" });
  }

  const valorLimpo = String(valor).trim();

  if (!config[tipo].includes(valorLimpo)) {
    config[tipo].push(valorLimpo);
  }

  salvarJSON(CONFIG_FILE, config);
  res.json({ ok: true });
});

// ===== PRODUTOS =====

// LISTAR
app.get("/produtos", async (req, res) => {
  try {
    const lista = await wc("get", "/products", null, {
      per_page: 100,
      status: "any"
    });

    const formatado = lista.map((p, i) => normalizarProdutoPainel(p, i));

    res.json(formatado);
  } catch (err) {
    console.log("Erro ao listar produtos:", err.response?.data || err.message);
    res.status(500).json([]);
  }
});

// CRIAR
app.post("/produtos", async (req, res) => {
  try {
    const d = req.body;

    if (!d.produto || !d.material || !d.tamanho || !d.acabamento) {
      return res.status(400).json({ erro: "Produto incompleto" });
    }

    if (!Array.isArray(d.precos) || d.precos.length === 0) {
      return res.status(400).json({ erro: "Adicione pelo menos um preço" });
    }

    let criado;

    if (d.precos.length === 1) {
      criado = await wc("post", "/products", montarProdutoSimples(d));
    } else {
      criado = await wc("post", "/products", montarProdutoVariavel(d));
      await criarVariacoes(criado.id, d.precos);
    }

    res.json({ ok: true, produto: criado });
  } catch (err) {
    console.log("Erro ao criar produto:", err.response?.data || err.message);
    res.status(500).json({ erro: true, detalhe: err.response?.data || err.message });
  }
});

// EDITAR
app.put("/produtos/:index", async (req, res) => {
  try {
    const index = Number(req.params.index);
    const lista = await wc("get", "/products", null, {
      per_page: 100,
      status: "any"
    });

    const produtoOriginal = lista[index];

    if (!produtoOriginal) {
      return res.status(400).json({ erro: "Produto não encontrado" });
    }

    const d = req.body;

    let atualizado;

    if (d.precos.length === 1) {
      if (produtoOriginal.type === "variable") {
        await deletarVariacoes(produtoOriginal.id);
      }

      atualizado = await wc("put", `/products/${produtoOriginal.id}`, montarProdutoSimples(d));
    } else {
      atualizado = await wc("put", `/products/${produtoOriginal.id}`, montarProdutoVariavel(d));

      await deletarVariacoes(produtoOriginal.id);
      await criarVariacoes(produtoOriginal.id, d.precos);
    }

    res.json({ ok: true, produto: atualizado });
  } catch (err) {
    console.log("Erro ao editar produto:", err.response?.data || err.message);
    res.status(500).json({ erro: true, detalhe: err.response?.data || err.message });
  }
});

// DUPLICAR
app.post("/produtos/:index/duplicar", async (req, res) => {
  try {
    const index = Number(req.params.index);
    const lista = await wc("get", "/products", null, {
      per_page: 100,
      status: "any"
    });

    const produtoOriginal = lista[index];

    if (!produtoOriginal) {
      return res.status(400).json({ erro: "Produto não encontrado" });
    }

    const normalizado = normalizarProdutoPainel(produtoOriginal, index);

    const copia = {
      produto: `${normalizado.produto} - Cópia`,
      material: normalizado.material,
      tamanho: normalizado.tamanho,
      acabamento: normalizado.acabamento,
      precos: normalizado.precos
    };

    let criado;

    if (copia.precos.length === 1) {
      criado = await wc("post", "/products", montarProdutoSimples(copia));
    } else {
      criado = await wc("post", "/products", montarProdutoVariavel(copia));
      await criarVariacoes(criado.id, copia.precos);
    }

    res.json({ ok: true, produto: criado });
  } catch (err) {
    console.log("Erro ao duplicar produto:", err.response?.data || err.message);
    res.status(500).json({ erro: true, detalhe: err.response?.data || err.message });
  }
});

// DELETAR
app.delete("/produtos/:index", async (req, res) => {
  try {
    const index = Number(req.params.index);
    const lista = await wc("get", "/products", null, {
      per_page: 100,
      status: "any"
    });

    const produto = lista[index];

    if (!produto) {
      return res.status(400).json({ erro: "Produto não encontrado" });
    }

    await wc("delete", `/products/${produto.id}`, null, {
      force: true
    });

    res.json({ ok: true });
  } catch (err) {
    console.log("Erro ao deletar produto:", err.response?.data || err.message);
    res.status(500).json({ erro: true, detalhe: err.response?.data || err.message });
  }
});

// STATS
app.get("/stats", async (req, res) => {
  try {
    const lista = await wc("get", "/products", null, {
      per_page: 100,
      status: "any"
    });

    const produtos = lista.map((p, i) => normalizarProdutoPainel(p, i));

    const categorias = {};
    let totalPrecos = 0;
    let somaPrecos = 0;

    produtos.forEach(p => {
      categorias[p.produto] = (categorias[p.produto] || 0) + 1;

      if (Array.isArray(p.precos)) {
        p.precos.forEach(pr => {
          const valor = Number(limparPreco(pr.preco));

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
  } catch (err) {
    console.log("Erro stats:", err.response?.data || err.message);

    res.json({
      totalProdutos: 0,
      totalCategorias: 0,
      mediaPreco: 0,
      categorias: {}
    });
  }
});

// ===== START =====
app.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta " + PORT);
});