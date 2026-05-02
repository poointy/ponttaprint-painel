require("dotenv").config();

const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const axios = require("axios");
const fs = require("fs");

const WC_URL = process.env.WC_URL;
const WC_KEY = process.env.WC_CONSUMER_KEY;
const WC_SECRET = process.env.WC_CONSUMER_SECRET;
const ADMIN = `${process.env.ADMIN_NUMBER}@c.us`;

if (!fs.existsSync("./artes")) {
  fs.mkdirSync("./artes", { recursive: true });
}

console.log("🚀 PONTTA PRINT BOT INICIANDO...");

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "pontta-print",
    dataPath: "./sessions"
  }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  }
});

const estado = {};
let cacheProdutos = [];

// ===== WOO API =====
async function buscarProdutos() {
  const res = await axios.get(`${WC_URL}/wp-json/wc/v3/products`, {
    params: {
      consumer_key: WC_KEY,
      consumer_secret: WC_SECRET,
      per_page: 50,
      status: "publish"
    }
  });

  cacheProdutos = res.data.filter(p => p.status === "publish");
  return cacheProdutos;
}

async function buscarVariacoes(produtoId) {
  const res = await axios.get(`${WC_URL}/wp-json/wc/v3/products/${produtoId}/variations`, {
    params: {
      consumer_key: WC_KEY,
      consumer_secret: WC_SECRET,
      per_page: 100
    }
  });

  return res.data;
}

function limparTexto(txt) {
  return String(txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function encontrarVariacao(variacoes, escolhas) {
  return variacoes.find(v => {
    return Object.keys(escolhas).every(nomeAtributo => {
      const escolhido = limparTexto(escolhas[nomeAtributo]);

      return v.attributes.some(attr => {
        return limparTexto(attr.name) === limparTexto(nomeAtributo) &&
               limparTexto(attr.option) === escolhido;
      });
    });
  });
}

function formatarPreco(valor) {
  if (!valor) return "Sob consulta";

  const numero = Number(String(valor).replace(",", "."));

  if (isNaN(numero)) return `R$ ${valor}`;

  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function resumoPedido(state) {
  let texto = `📋 *Pedido Pontta Print*\n\n`;
  texto += `🧾 Produto: ${state.produto.name}\n`;

  Object.keys(state.escolhas).forEach(chave => {
    texto += `🔹 ${chave}: ${state.escolhas[chave]}\n`;
  });

  texto += `\n💰 Valor: ${formatarPreco(state.preco)}\n`;
  texto += `🔗 Link: ${state.produto.permalink}\n\n`;
  texto += `⚡ Produção conforme descrição do produto\n`;
  texto += `🚚 Entrega para todo o Brasil`;

  return texto;
}

// ===== QR =====
client.on("qr", qr => {
  console.log("📲 Escaneie o QR:");
  qrcode.generate(qr, { small: true });
});

// ===== READY =====
client.on("ready", async () => {
  console.log("✅ BOT ONLINE");

  try {
    await buscarProdutos();
    console.log(`📦 Produtos carregados do site: ${cacheProdutos.length}`);
  } catch (err) {
    console.log("❌ Erro ao carregar produtos do site:");
    console.log(err.response?.data || err.message);
  }
});

client.on("disconnected", () => {
  console.log("❌ Reconectando...");
  client.initialize();
});

// ===== BOT =====
client.on("message", async (msg) => {
  try {
    if (msg.from.includes("@g.us")) return;

    const user = msg.from;
    const text = msg.body?.trim();

    if (!text) return;

    if (!estado[user]) {
      estado[user] = {
        step: "inicio"
      };
    }

    let state = estado[user];

    if (text.toLowerCase() === "menu") {
      estado[user] = { step: "inicio" };
      state = estado[user];
    }

    // ===== INÍCIO =====
    if (state.step === "inicio") {
      const produtos = await buscarProdutos();

      if (!produtos.length) {
        return client.sendMessage(user, "❌ Nenhum produto disponível no momento.");
      }

      state.step = "produto";

      let menu = `👋 *Bem-vindo à Pontta Print*\n\n`;
      menu += `Escolha um produto:\n\n`;

      produtos.forEach((p, i) => {
        const preco = p.price_html
          ? p.price_html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
          : formatarPreco(p.price);

        menu += `${i + 1}️⃣ ${p.name}\n`;
        menu += `💰 ${preco || "Sob consulta"}\n\n`;
      });

      menu += `Digite o número do produto.`;

      return client.sendMessage(user, menu);
    }

    // ===== PRODUTO =====
    if (state.step === "produto") {
      const index = parseInt(text) - 1;
      const produto = cacheProdutos[index];

      if (!produto) {
        return client.sendMessage(user, "❌ Produto inválido. Digite *menu* para começar novamente.");
      }

      state.produto = produto;
      state.atributos = produto.attributes || [];
      state.escolhas = {};
      state.atributoAtual = 0;

      if (!state.atributos.length) {
        state.preco = produto.price || "";
        state.step = "arte";

        return client.sendMessage(user,
`🧾 *${produto.name}*

💰 Valor: ${formatarPreco(state.preco)}

🎨 Você já possui a arte?

1️⃣ Sim
2️⃣ Não`);
      }

      state.step = "atributo";

      const atributo = state.atributos[state.atributoAtual];

      let msgAtributo = `🧾 *${produto.name}*\n\n`;
      msgAtributo += `Escolha: *${atributo.name}*\n\n`;

      atributo.options.forEach((op, i) => {
        msgAtributo += `${i + 1}️⃣ ${op}\n`;
      });

      return client.sendMessage(user, msgAtributo);
    }

    // ===== ATRIBUTOS DINÂMICOS =====
    if (state.step === "atributo") {
      const atributo = state.atributos[state.atributoAtual];
      const index = parseInt(text) - 1;
      const opcao = atributo.options[index];

      if (!opcao) {
        return client.sendMessage(user, "❌ Opção inválida. Escolha uma das opções da lista.");
      }

      state.escolhas[atributo.name] = opcao;
      state.atributoAtual++;

      if (state.atributoAtual < state.atributos.length) {
        const prox = state.atributos[state.atributoAtual];

        let msgProx = `Escolha: *${prox.name}*\n\n`;

        prox.options.forEach((op, i) => {
          msgProx += `${i + 1}️⃣ ${op}\n`;
        });

        return client.sendMessage(user, msgProx);
      }

      // terminou atributos
      let preco = state.produto.price || "";
      let variacaoEncontrada = null;

      if (state.produto.type === "variable") {
        const variacoes = await buscarVariacoes(state.produto.id);
        variacaoEncontrada = encontrarVariacao(variacoes, state.escolhas);

        if (variacaoEncontrada) {
          preco = variacaoEncontrada.price || variacaoEncontrada.regular_price || "";
          state.variacaoId = variacaoEncontrada.id;
        }
      }

      state.preco = preco;
      state.step = "arte";

      let resumo = `✅ *Configuração escolhida:*\n\n`;
      resumo += `🧾 Produto: ${state.produto.name}\n`;

      Object.keys(state.escolhas).forEach(chave => {
        resumo += `🔹 ${chave}: ${state.escolhas[chave]}\n`;
      });

      resumo += `\n💰 Valor: ${formatarPreco(state.preco)}\n\n`;

      if (!variacaoEncontrada && state.produto.type === "variable") {
        resumo += `⚠️ Não encontrei uma variação exata para essa combinação. Nossa equipe irá confirmar o valor.\n\n`;
      }

      resumo += `🎨 Você já possui a arte?\n\n`;
      resumo += `1️⃣ Sim\n`;
      resumo += `2️⃣ Não`;

      return client.sendMessage(user, resumo);
    }

    // ===== ARTE =====
    if (state.step === "arte") {
      if (text === "1") {
        state.step = "arquivo";
        return client.sendMessage(user, "📎 Envie o arquivo da arte em PDF ou imagem.");
      }

      if (text === "2") {
        return finalizar(user, state);
      }

      return client.sendMessage(user, "❌ Responda com 1 ou 2.");
    }

    // ===== RECEBER ARQUIVO =====
    if (state.step === "arquivo") {
      if (!msg.hasMedia) {
        return client.sendMessage(user, "❌ Envie um arquivo válido em PDF ou imagem.");
      }

      const media = await msg.downloadMedia();

      let ext = "bin";

      if (media.mimetype.includes("image")) ext = "png";
      if (media.mimetype.includes("pdf")) ext = "pdf";

      const nome = `${Date.now()}_${user.replace("@c.us", "")}.${ext}`;

      fs.writeFileSync(`./artes/${nome}`, media.data, {
        encoding: "base64"
      });

      state.arquivo = nome;

      await client.sendMessage(user, "✅ Arquivo recebido com sucesso!");

      return finalizar(user, state);
    }

  } catch (err) {
    console.log("❌ Erro no bot:");
    console.log(err.response?.data || err.message);

    return client.sendMessage(msg.from, "❌ Ocorreu um erro. Digite *menu* para começar novamente.");
  }
});

// ===== FINALIZAR =====
async function finalizar(user, state) {
  const resumo = resumoPedido(state);

  fs.appendFileSync("pedidos.txt", resumo + "\n\n");

  await client.sendMessage(ADMIN, `📥 *NOVO PEDIDO:*\n\n${resumo}`);

  estado[user] = { step: "inicio" };

  return client.sendMessage(user,
`✅ Pedido recebido!

Nossa equipe já vai dar andamento 🚀

Digite *menu* se quiser fazer outro pedido.`);
}

// START
client.initialize();