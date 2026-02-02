// --- CONFIGURAÇÃO SUPABASE ---
const SUPABASE_URL = 'https://ehjtfhltnefsjketvumy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoanRmaGx0bmVmc2prZXR2dW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4OTQ3NDAsImV4cCI6MjA4NTQ3MDc0MH0.B_48kBjvRYk9sdZKlrpPlDROiPOsMnGpRva-jmgukVc';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Variáveis globais alimentadas pelo banco
let catalog = [];
let sales = [];
let pendingSale = null;

// Verifique se no HTML o valor é "Pix" ou "pix", "Débito" ou "debito"
const CONFIG_TAXAS = {
    'Pix': 0.005,      // 0.5%
    'Débito': 0.02,    // 2%
    'Crédito': 0.05,   // 5%
    'Dinheiro': 0
};

// --- INICIALIZAÇÃO ---
async function init() {
    checkAuth();
    await carregarDadosDoBanco();
    
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    const clockEl = document.getElementById('live-clock');
    if(clockEl) clockEl.innerText = new Date().toLocaleDateString('pt-BR', options);
}


async function carregarDadosDoBanco() {
    console.log("Iniciando busca de dados...");

    const [resCatalog, resVendas, resDespesas] = await Promise.all([
        _supabase.from('itens_catalogo').select('*'),
        _supabase.from('vendas').select('*'),
        _supabase.from('despesas').select('*')
    ]);

    catalog = resCatalog.data || [];

    const despesasFormatadas = (resDespesas.data || []).map(d => ({
        id: d.id,
        item_nome: d.descricao,
        valor: -Math.abs(d.valor),
        tipo: 'saida',
        data_venda: d.data_pagamento,
        metodo_pagamento: d.metodo_pagamento
    }));

    sales = [...(resVendas.data || []), ...despesasFormatadas];

    updateUI();
    updateReports();

    // 🔥 TEM QUE SER AQUI
    renderDespesas();
}


// 1. Abre o modal de confirmação a partir da despesa
function executarSaida() {
    const desc = document.getElementById('expenseDesc').value;
    const valor = document.getElementById('expenseVal').value;

    if (!desc || !valor) {
        alert("Preencha a descrição e o valor da despesa!");
        return;
    }

    // Alimenta o objeto global que o executeSale() já usa
    pendingSale = { 
        price: valor, 
        name: desc, 
        type: 'saida' 
    };

    // Preenche o preview do modal de confirmação (estilo despesa)
    const preview = document.getElementById('salePreview');
    if (preview) {
        preview.innerHTML = `
            <p style="margin:0; color:var(--danger); font-size:0.8rem; text-transform:uppercase;">Registrar Despesa</p>
            <h2 style="margin:10px 0; color:white;">${desc}</h2>
            <p style="margin:0; font-size:1.5rem; color:var(--danger); font-weight:700;">R$ ${parseFloat(valor).toFixed(2)}</p>
        `;
    }

    // Fecha o modal de input e abre o de confirmação de pagamento
    closeModal('modal-despesa');
    document.getElementById('confirmSaleModal').style.display = 'flex';
    
}


function renderDespesas() {
    const container = document.getElementById('list-despesas');
    if (!container) return;

    const despesas = sales.filter(d => d.tipo === 'saida');

    if (!despesas.length) {
        container.innerHTML = '<p style="opacity:.6">Nenhuma despesa registrada</p>';
        return;
    }

    container.innerHTML = despesas.map(d => `
        <div class="inventory-item expense-item">

            <div class="item-left">
                <span class="item-name">${d.item_nome}</span>
            </div>

            <div class="item-right">
                <span class="item-price negative">
                    - R$ ${Math.abs(d.valor).toFixed(2)}
                </span>

                <div class="item-actions">
                    <button class="icon-btn">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="icon-btn danger">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>

        </div>
    `).join('');
}


// 2. Controla a seleção visual dos botões de pagamento no modal
function selectMethod(element, method) {
    // Remove a classe 'active' de todos os botões do grid
    document.querySelectorAll('.pay-btn').forEach(btn => btn.classList.remove('active'));
    
    // Adiciona ao que foi clicado
    element.classList.add('active');
    
    // Atualiza o input hidden que o executeSale() lê
    document.getElementById('paymentMethod').value = method;
}


async function finalizacaoDaVendaOuDespesa(metodoSelecionado, valor, item_nome, tipo) {
    // Se o tipo for 'saida', usamos a tabela 'despesas', senão usamos 'vendas'
    const tabelaDestino = (tipo === 'saida') ? 'despesas' : 'vendas';

    const dadosParaSalvar = (tipo === 'saida') ? {
        descricao: item_nome, // Na tabela despesas a coluna chama-se 'descricao'
        valor: parseFloat(valor),
        data_pagamento: new Date().toISOString(), //
        metodo_pagamento: metodoSelecionado // SALVA O QUE VOCÊ CLICOU NA MODAL
    } : {
        item_nome: item_nome,
        valor: parseFloat(valor),
        tipo: tipo,
        data_venda: new Date().toISOString(),
        metodo_pagamento: metodoSelecionado
    };

    try {
        const { error } = await _supabase.from(tabelaDestino).insert([dadosParaSalvar]);
        if (error) throw error;

        await carregarDadosDoBanco(); // Atualiza a UI e Relatórios
        showToast("Registrado com sucesso!");
        
        // Limpa os campos de despesa se for o caso
        if(tipo === 'saida') {
            document.getElementById('expenseVal').value = "";
            document.getElementById('expenseDesc').value = "";
        }
    } catch (err) {
        console.error("Erro:", err);
    }
}


// --- NAVEGAÇÃO ENTRE ABAS ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(tabId).classList.add('active');
    
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }

    if(tabId === 'stats') updateReports();
}


// --- GESTÃO DO CATÁLOGO (NUVEM) ---
async function addItem() {
    const name = document.getElementById('itemName').value;
    const price = parseFloat(document.getElementById('itemPrice').value);
    const type = document.getElementById('itemType').value;

    if (!name || isNaN(price)) {
        alert("Preencha o nome e o preço corretamente.");
        return;
    }

    const { error } = await _supabase
        .from('itens_catalogo')
        .insert([{ nome: name, preco: price, tipo: type }]);

    if (error) {
        alert("Erro ao salvar no banco de dados.");
    } else {
        document.getElementById('itemName').value = '';
        document.getElementById('itemPrice').value = '';
        await carregarDadosDoBanco();
        showToast("Item adicionado ao catálogo!");
    }
}


function openEditModal(id) {
    const item = catalog.find(i => i.id === id);
    if (!item) return;

    document.getElementById('editItemId').value = item.id;
    document.getElementById('editItemName').value = item.nome;
    document.getElementById('editItemPrice').value = item.preco;
    document.getElementById('editItemType').value = item.tipo;

    document.getElementById('editModal').style.display = 'flex';
}


function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}


async function saveEdit() {
    const id = document.getElementById('editItemId').value;
    const name = document.getElementById('editItemName').value;
    const price = parseFloat(document.getElementById('editItemPrice').value);
    const type = document.getElementById('editItemType').value;

    const { error } = await _supabase
        .from('itens_catalogo')
        .update({ nome: name, preco: price, tipo: type })
        .eq('id', id);

    if (error) {
        alert("Erro ao atualizar item.");
    } else {
        closeEditModal();
        await carregarDadosDoBanco();
        showToast("Item atualizado!");
    }
}


async function deleteItem(id) {
    if(confirm("Deseja realmente excluir este item permanentemente da nuvem?")) {
        const { error } = await _supabase.from('itens_catalogo').delete().eq('id', id);
        if (!error) await carregarDadosDoBanco();
    }
}


// --- LÓGICA DE VENDAS ---
function makeSale(price, name, type) {
    pendingSale = { price, name, type };

    // Removida a inserção direta no visor lateral para aparecer apenas após confirmação
    const preview = document.getElementById('salePreview');
    if (preview) {
        preview.innerHTML = `
            <p style="margin:0; color:var(--text-secondary);">Item selecionado:</p>
            <h2 style="margin:10px 0; color:white;">${name}</h2>
            <p style="margin:0; font-size:1.5rem; color:var(--success); font-weight:700;">R$ ${parseFloat(price).toFixed(2)}</p>
        `;
    }
    document.getElementById('confirmSaleModal').style.display = 'flex';
}


async function executeSale() {
    if (!pendingSale) return;

    // 1. Definição das taxas conforme solicitado
    const CONFIG_TAXAS = {
        'Pix': 0.005,      // 0.5%
        'Débito': 0.02,    // 2%
        'Crédito': 0.05,   // 5%
        'Dinheiro': 0
    };

    const { price, name, type } = pendingSale;
    const metodo = document.getElementById('paymentMethod').value; // Certifique-se que o value no HTML é igual às chaves acima
    const valBruto = parseFloat(price);

    // 2. Cálculo lógico das novas colunas
    // Buscamos o percentual no objeto. Se não existir, assume 0.
    const percentual = CONFIG_TAXAS[metodo] || 0;
    const valorTaxa = valBruto * percentual;
    const valorLiquido = valBruto - valorTaxa;

    const tabelaDestino = (type === 'saida') ? 'despesas' : 'vendas';

    // 3. Preparação do objeto de dados com as colunas valor_liquido e valor_taxa
    const dadosParaSalvar = (type === 'saida') ? {
        descricao: name,
        valor: valBruto,
        data_pagamento: new Date().toISOString(),
        metodo_pagamento: metodo 
    } : { 
        item_nome: name, 
        valor: valBruto,           // Valor Bruto (ex: 28.00)
        valor_liquido: valorLiquido, // Valor Líquido (ex: 27.44)
        valor_taxa: valorTaxa,      // Valor da Taxa (ex: 0.56)
        tipo: type,
        data_venda: new Date().toISOString(),
        metodo_pagamento: metodo 
    };

    // Log de segurança para conferir no console antes de enviar
    console.log("Tentando salvar:", dadosParaSalvar);

    try {
        const { error } = await _supabase
            .from(tabelaDestino)
            .insert([dadosParaSalvar]);

        if (error) throw error;

        // Sucesso: Atualiza sistema e limpa interface
        await carregarDadosDoBanco(); 
        closeConfirmModal();
        showToast(`Lançado: ${name} (${metodo})`);
        
        if(type === 'saida') {
            document.getElementById('expenseDesc').value = '';
            document.getElementById('expenseVal').value = '';
        }

    } catch (error) {
        console.error("Erro no Supabase:", error);
        alert("Erro ao registrar lançamento no banco de dados.");
    }
}


function closeConfirmModal() {
    document.getElementById('confirmSaleModal').style.display = 'none';
    pendingSale = null;
}


// --- ATUALIZAÇÃO DA INTERFACE ---
function updateUI() {
    const gridServicos = document.getElementById('grid-servicos');
    const gridProdutos = document.getElementById('grid-produtos');
    const listServicosAdmin = document.getElementById('list-servicos');
    const listProdutosAdmin = document.getElementById('list-produtos');
    
    if(gridServicos) gridServicos.innerHTML = '';
    if(gridProdutos) gridProdutos.innerHTML = '';
    if(listServicosAdmin) listServicosAdmin.innerHTML = '';
    if(listProdutosAdmin) listProdutosAdmin.innerHTML = '';

    catalog.forEach(item => {
        // Definimos o ícone primeiro para usar no card
        const icone = item.tipo === 'servico' ? 'fa-cut' : 'fa-box';

        const cardHtml = `
            <div class="item-card" onclick="makeSale(${item.preco}, '${item.nome}', '${item.tipo}')">
                <i class="fas ${icone}" style="font-size: 1.5rem; color: var(--accent); margin-bottom: 10px;"></i>
                <strong>${item.nome}</strong>
                <span>R$ ${parseFloat(item.preco).toFixed(2)}</span>
            </div>
        `;

        if(item.tipo === 'servico' && gridServicos) gridServicos.innerHTML += cardHtml;
        else if(item.tipo === 'produto' && gridProdutos) gridProdutos.innerHTML += cardHtml;

        // O restante do seu código de Admin continua igual abaixo
        const classeCor = item.tipo === 'servico' ? 'item-servico' : 'item-produto';

        const adminItemHtml = `
            <div class="inventory-item ${classeCor}">
                <div class="item-info">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <i class="fas ${icone}" style="opacity:0.4; font-size:0.8rem"></i>
                        <span class="item-name">${item.nome}</span>
                    </div>
                    <strong class="item-price-tag">R$ ${parseFloat(item.preco).toFixed(2)}</strong>
                </div>
                <div class="item-actions">
                    <button class="btn-icon" onclick="openEditModal(${item.id})"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon del" onclick="deleteItem(${item.id})"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;

        if(item.tipo === 'servico' && listServicosAdmin) listServicosAdmin.innerHTML += adminItemHtml;
        else if(item.tipo === 'produto' && listProdutosAdmin) listProdutosAdmin.innerHTML += adminItemHtml;
    });

    if(document.getElementById('count-servicos')) 
        document.getElementById('count-servicos').innerText = catalog.filter(i => i.tipo === 'servico').length;
    if(document.getElementById('count-produtos')) 
        document.getElementById('count-produtos').innerText = catalog.filter(i => i.tipo === 'produto').length;

    atualizarSaldoCaixa();
    renderRecentSales();
}


function atualizarSaldoCaixa() {
    const todayStr = new Date().toLocaleDateString();
    
    // Filtra as vendas de hoje (ignorando saídas)
    const vendasHoje = sales.filter(s => 
        new Date(s.data_venda).toLocaleDateString() === todayStr && s.tipo !== 'saida'
    );

    // Soma o total
    const totalHoje = vendasHoje.reduce((acc, s) => acc + parseFloat(s.valor), 0);

    const cashEl = document.getElementById('cash-balance');
    if (cashEl) {
        cashEl.innerText = `R$ ${totalHoje.toFixed(2)}`;
    }

    // --- RECONSTRUÇÃO DA LISTA NO VISOR LATERAL ---
    const listContainer = document.getElementById('display-items-list');
    if (listContainer) {
        listContainer.innerHTML = ''; // Limpa para não duplicar itens antigos
        
        vendasHoje.forEach(item => {
            const itemEntry = document.createElement('div');
            itemEntry.style = "display:flex; justify-content:space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.03); animation: slideIn 0.3s ease;";
            itemEntry.innerHTML = `
                <span style="font-size:0.75rem; color:#aaa;">${item.item_nome}</span>
                <span style="font-size:0.75rem; color:var(--accent); font-weight:700;">R$ ${parseFloat(item.valor).toFixed(2)}</span>
            `;
            listContainer.appendChild(itemEntry);
        });
        
        // Mantém o scroll sempre no último item lançado
        listContainer.scrollTop = listContainer.scrollHeight;
    }
}


// --- SEGURANÇA E AUTH ---
function checkAuth() {
    const isLogged = localStorage.getItem('barber_logged') || sessionStorage.getItem('barber_logged');
    if (isLogged !== 'true') {
        window.location.href = 'login.html';
    }
}


function logout() {
    localStorage.removeItem('barber_logged');
    sessionStorage.removeItem('barber_logged');
    document.body.style.opacity = '0';
    setTimeout(() => window.location.href = 'login.html', 500);
}


// --- RELATÓRIOS E PDF (ATUALIZADO E SINCRONIZADO) ---
function updateReports(periodo = 'hoje', btn = null) {
    if (btn) {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    const now = new Date();
    const todayStr = now.toLocaleDateString('pt-BR');
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const firstDayMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Acrescentamos 'liquido' e 'taxas' para controle preciso
    let statsFiltro = { bruto: 0, liquido: 0, taxas: 0, exp: 0, serv: 0, prod: 0 };
    let stats = {
        todayGross: 0, todayNet: 0, todayExp: 0, week: 0,
        monthGross: 0, monthExp: 0,
        servicos: 0, produtos: 0, totalDespesasGerais: 0
    };

    const totalsByDay = {};

    sales.forEach(sale => {
        const d = new Date(sale.data_venda || sale.data_pagamento);
        const dStr = d.toLocaleDateString('pt-BR');
        
        const valBruto = parseFloat(sale.valor) || 0;
        // Se for saída, não tem taxa, senão usa a coluna valor_liquido (fallback para o bruto se estiver vazio)
        const valLiquido = sale.tipo === 'saida' ? valBruto : (parseFloat(sale.valor_liquido) || valBruto);
        const valTaxa = sale.tipo === 'saida' ? 0 : (parseFloat(sale.valor_taxa) || 0);

        // --- Histórico Diário agora usa o VALOR LÍQUIDO (dinheiro real) ---
        if (sale.tipo !== 'saida') {
            totalsByDay[dStr] = (totalsByDay[dStr] || 0) + valLiquido;
        }

        if (dStr === todayStr) {
            if (sale.tipo !== 'saida') {
                stats.todayGross += valBruto;
                stats.todayNet += valLiquido;
            } else {
                stats.todayExp += Math.abs(valBruto);
            }
        }
        
        if (d >= oneWeekAgo && sale.tipo !== 'saida') stats.week += valBruto;
        
        if (d >= firstDayMonth) {
            if (sale.tipo !== 'saida') stats.monthGross += valBruto;
            else stats.monthExp += Math.abs(valBruto);
        }

        if (sale.tipo === 'servico') stats.servicos += valBruto;
        else if (sale.tipo === 'produto') stats.produtos += valBruto;
        else if (sale.tipo === 'saida') stats.totalDespesasGerais += Math.abs(valBruto);

        let incluirNoFiltro = false;
        if (periodo === 'hoje' && dStr === todayStr) incluirNoFiltro = true;
        else if (periodo === 'ontem') {
            const ontem = new Date();
            ontem.setDate(now.getDate() - 1);
            if (dStr === ontem.toLocaleDateString('pt-BR')) incluirNoFiltro = true;
        } 
        else if (periodo === 'semana' && d >= oneWeekAgo) incluirNoFiltro = true;
        else if (periodo === 'mes' && d >= firstDayMonth) incluirNoFiltro = true;

        if (incluirNoFiltro) {
            if (sale.tipo !== 'saida') {
                statsFiltro.bruto += valBruto;
                statsFiltro.liquido += valLiquido;
                statsFiltro.taxas += valTaxa;
                if (sale.tipo === 'servico') statsFiltro.serv += valBruto;
                if (sale.tipo === 'produto') statsFiltro.prod += valBruto;
            } else {
                statsFiltro.exp += Math.abs(valBruto);
            }
        }
    });

    // Atualização da UI
    const cashEl = document.getElementById('cash-balance');
    if (cashEl) cashEl.innerText = `R$ ${stats.todayNet.toFixed(2)}`;

    // Cálculo do Lucro Líquido Real (Vendas Líquidas - Despesas Físicas)
    const lucroRealPeriodo = statsFiltro.liquido - statsFiltro.exp;

    if(document.getElementById('today-net')) {
        document.getElementById('today-net').innerText = `R$ ${lucroRealPeriodo.toFixed(2)}`;
        document.getElementById('today-gross-val').innerText = `R$ ${statsFiltro.bruto.toFixed(2)}`;
        
        // Aqui mostramos Despesas Totais (Gastos + Mordida da Maquininha)
        const totalPerda = statsFiltro.exp + statsFiltro.taxas;
        document.getElementById('today-expense-val').innerText = `R$ ${totalPerda.toFixed(2)}`;
    }
    
    if(document.getElementById('month-expenses-val')) {
        document.getElementById('month-expenses-val').innerText = `R$ ${stats.monthExp.toFixed(2)}`;
    }
    
    document.getElementById('week-total').innerText = `R$ ${stats.week.toFixed(2)}`;
    document.getElementById('month-total-val').innerText = `R$ ${stats.monthGross.toFixed(2)}`;

    // Renderizar Histórico Diário
    const dailyHistoryList = document.getElementById('daily-history-list');
    if (dailyHistoryList) {
        dailyHistoryList.innerHTML = '';
        const sortedDates = Object.keys(totalsByDay).sort((a, b) => {
            return new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-'));
        });
        
        sortedDates.slice(0, 7).forEach(date => {
            const div = document.createElement('div');
            div.style = "display: flex; justify-content: space-between; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 5px; border-left: 3px solid #5d5fef;";
            div.innerHTML = `<span style="font-size: 0.8rem; color: #aaa;">${date}</span><b style="color: #2ecc71;">R$ ${totalsByDay[date].toFixed(2)}</b>`;
            dailyHistoryList.appendChild(div);
        });
    }

    atualizarVisual(statsFiltro.serv, statsFiltro.prod, statsFiltro.exp, periodo);
}


// --- FUNÇÃO DE EXPORTAR PDF (COM TAXAS, TOTAIS E FECHAMENTOS DIÁRIOS) ---
async function exportarRelatorioPDF(modo = 'geral') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // --- LÓGICA DE FILTRAGEM E VALIDAÇÃO ---
    let vendasFiltradas = [...sales]; 

    if (modo === 'custom') {
        const inputStart = document.getElementById('dateStart').value;
        const inputEnd = document.getElementById('dateEnd').value;

        if (!inputStart || !inputEnd) {
            alert("⚠️ Por favor, selecione as datas de Início e Fim para exportar o relatório do período.");
            return; 
        }

        const dInicio = new Date(inputStart);
        dInicio.setHours(0, 0, 0, 0);
        const dFim = new Date(inputEnd);
        dFim.setHours(23, 59, 59, 999);

        vendasFiltradas = sales.filter(s => {
            const dataVenda = new Date(s.data_venda);
            return dataVenda >= dInicio && dataVenda <= dFim;
        });

    } else if (modo === 'mensal') {
        const agora = new Date();
        const primeiroDia = new Date(agora.getFullYear(), agora.getMonth(), 1);
        vendasFiltradas = sales.filter(s => new Date(s.data_venda) >= primeiroDia);
    }

    if (vendasFiltradas.length === 0) {
        alert("Nenhum registro encontrado para o período selecionado.");
        return;
    }

    const nomeBarbearia = "BARBEARIA GOUVÊA"; 
    const dataEmissao = new Date().toLocaleString('pt-BR');
    
    // --- CABEÇALHO ---
    doc.setFillColor(30, 30, 45); 
    doc.rect(0, 0, 210, 45, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.text(nomeBarbearia, 15, 22);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("GESTÃO FINANCEIRA PROFISSIONAL", 15, 32);
    doc.text(`EMITIDO EM: ${dataEmissao}`, 145, 32);

    // --- CÁLCULOS ---
    let servTotal = 0, prodTotal = 0, expTotal = 0, taxaTotalAcumulada = 0;
    let qtdVendas = 0, qtdServicos = 0, qtdProdutos = 0;
    const metodos = {};
    const rankingItens = { servicos: {}, produtos: {} };
    const fechamentosDiarios = {}; // Novo objeto para agrupamento por dia

    const infoTaxas = {
        'Pix': '0.50%',
        'Débito': '2%',
        'Crédito': '5%',
        'Dinheiro': '0%'
    };

    vendasFiltradas.forEach(s => {
        const v = parseFloat(s.valor) || 0;
        const tx = parseFloat(s.valor_taxa) || 0;
        const nomeItem = s.item_nome || "Item sem nome";
        const dataDia = new Date(s.data_venda).toLocaleDateString('pt-BR');

        // Inicializa o dia no agrupador
        if (!fechamentosDiarios[dataDia]) {
            fechamentosDiarios[dataDia] = { entradas: 0, saidas: 0, taxas: 0, qtd: 0 };
        }

        if (s.tipo !== 'saida') {
            qtdVendas++;
            taxaTotalAcumulada += tx;
            fechamentosDiarios[dataDia].entradas += v;
            fechamentosDiarios[dataDia].taxas += tx;
            fechamentosDiarios[dataDia].qtd++;

            if (s.tipo === 'servico') {
                servTotal += v;
                qtdServicos++;
                rankingItens.servicos[nomeItem] = (rankingItens.servicos[nomeItem] || 0) + 1;
            } else if (s.tipo === 'produto') {
                prodTotal += v;
                qtdProdutos++;
                rankingItens.produtos[nomeItem] = (rankingItens.produtos[nomeItem] || 0) + 1;
            }
            
            const m = s.metodo_pagamento || "Não informado";
            if (!metodos[m]) metodos[m] = { valor: 0, qtd: 0 };
            metodos[m].valor += v;
            metodos[m].qtd += 1;
        } else {
            const despesa = Math.abs(v);
            expTotal += despesa;
            fechamentosDiarios[dataDia].saidas += despesa;
        }
    });

    const encontrarTop = (obj) => {
        const entradas = Object.entries(obj);
        if (entradas.length === 0) return "---";
        return entradas.sort((a, b) => b[1] - a[1])[0][0];
    };

    const topServico = encontrarTop(rankingItens.servicos);
    const topProduto = encontrarTop(rankingItens.produtos);
    const lucroBruto = servTotal + prodTotal;
    const lucroLiquido = lucroBruto - expTotal - taxaTotalAcumulada;
    const ticketMedio = qtdVendas > 0 ? (lucroBruto / qtdVendas) : 0;

    // --- BLOCO DE INDICADORES (KPIs) ---
    doc.setTextColor(40, 40, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("RESUMO DO PERÍODO", 15, 58);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Total de Cortes: ${qtdServicos} | Mais feito: ${topServico}`, 15, 66);
    doc.text(`Total de Produtos: ${qtdProdutos} | Mais vendido: ${topProduto}`, 15, 71);

    doc.setFontSize(10);
    doc.text(`Faturamento (Serviços): R$ ${servTotal.toFixed(2)}`, 15, 80);
    doc.text(`Faturamento (Produtos): R$ ${prodTotal.toFixed(2)}`, 15, 86);
    doc.text(`Atendimentos: ${qtdVendas}`, 120, 80);
    doc.text(`Ticket Médio: R$ ${ticketMedio.toFixed(2)}`, 120, 86);

    doc.setFont("helvetica", "bold");
    doc.text(`LUCRO BRUTO: R$ ${lucroBruto.toFixed(2)}`, 15, 95);
    doc.setTextColor(200, 0, 0);
    doc.text(`TAXAS: R$ ${taxaTotalAcumulada.toFixed(2)}`, 85, 95);
    doc.text(`DESPESAS: R$ ${expTotal.toFixed(2)}`, 145, 95);

    doc.setFillColor(245, 245, 250);
    doc.rect(15, 100, 180, 12, 'F');
    doc.setTextColor(lucroLiquido >= 0 ? 0 : 200, 100, 0);
    doc.setFontSize(14);
    doc.text(`LUCRO LÍQUIDO FINAL: R$ ${lucroLiquido.toFixed(2)}`, 60, 108);

    // --- MÉTODOS DE PAGAMENTO ---
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("ENTRADAS POR MÉTODO E TAXAS", 15, 125);
    let yM = 135;
    Object.keys(metodos).forEach(m => {
        const taxaTexto = infoTaxas[m] ? `(${infoTaxas[m]})` : "";
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.text(`${m} ${taxaTexto}: ${metodos[m].qtd}x - Total Bruto: R$ ${metodos[m].valor.toFixed(2)}`, 20, yM);
        yM += 6;
    });

    // --- BLOCO: FECHAMENTOS DIÁRIOS (ESTILO TABELA ANALÍTICA) ---
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("FECHAMENTOS DIÁRIOS", 15, yM + 10);

    let yD = yM + 20;
    doc.setFillColor(45, 45, 63);
    doc.rect(10, yD - 5, 190, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.text("DATA", 12, yD);
    doc.text("ATENDIMENTOS", 40, yD);
    doc.text("BRUTO DIA", 80, yD);
    doc.text("SAÍDAS", 115, yD);
    doc.text("TAXAS", 150, yD);
    doc.text("LÍQUIDO DIA", 180, yD);

    yD += 8;
    doc.setTextColor(40, 40, 40);
    doc.setFont("helvetica", "normal");
    
    const datasOrdenadas = Object.keys(fechamentosDiarios).sort((a, b) => {
        return new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-'));
    });

    datasOrdenadas.forEach(data => {
        const d = fechamentosDiarios[data];
        const saldoDia = d.entradas - d.saidas - d.taxas;
        
        if (yD > 275) { doc.addPage(); yD = 25; }
        
        doc.text(data, 12, yD);
        doc.text(`${d.qtd}x`, 40, yD);
        doc.setTextColor(0, 100, 0);
        doc.text(`R$ ${d.entradas.toFixed(2)}`, 80, yD);
        doc.setTextColor(200, 0, 0);
        doc.text(`R$ ${d.saidas.toFixed(2)}`, 115, yD);
        doc.setTextColor(150, 0, 0);
        doc.text(`R$ ${d.taxas.toFixed(2)}`, 150, yD);
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "bold");
        doc.text(`R$ ${saldoDia.toFixed(2)}`, 180, yD);
        doc.setFont("helvetica", "normal");

        doc.setDrawColor(240);
        doc.line(10, yD + 2, 200, yD + 2);
        yD += 7;
    });

    // --- LISTAGEM ANALÍTICA ---
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("LISTAGEM ANALÍTICA DETALHADA", 15, yD + 10);
    
    let y = yD + 20;
    doc.setFillColor(45, 45, 63);
    doc.rect(10, y - 5, 190, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.text("DATA", 12, y);
    doc.text("DESCRIÇÃO", 32, y);
    doc.text("CATEGORIA", 75, y);
    doc.text("MÉTODO", 110, y);
    doc.text("TAXA", 140, y);
    doc.text("LÍQUIDO", 165, y);
    doc.text("BRUTO", 188, y);
    
    y += 10;
    doc.setTextColor(40, 40, 40);
    doc.setFont("helvetica", "normal");

    const historico = [...vendasFiltradas].sort((a, b) => new Date(b.data_venda) - new Date(a.data_venda));

    historico.forEach((s) => {
        if (y > 270) { doc.addPage(); y = 25; }

        const v = parseFloat(s.valor) || 0;
        const tx = parseFloat(s.valor_taxa) || 0;
        const liq = s.tipo === 'saida' ? -Math.abs(v) : (parseFloat(s.valor_liquido) || (v - tx));

        doc.text(new Date(s.data_venda).toLocaleDateString('pt-BR'), 12, y);
        doc.text((s.item_nome || "---").substring(0, 20), 32, y);
        doc.text(s.tipo.toUpperCase() === 'SAIDA' ? 'SAÍDA - DESPESA' : s.tipo.toUpperCase(), 75, y);
        doc.text(s.metodo_pagamento || "---", 110, y);
        
        doc.setTextColor(150, 0, 0);
        doc.text(tx > 0 ? `R$ ${tx.toFixed(2)}` : "---", 140, y);
        doc.setTextColor(0, 0, 0);
        doc.text(`R$ ${liq.toFixed(2)}`, 165, y);

        if (s.tipo === 'saida') {
            doc.setTextColor(200, 0, 0);
            doc.text(`- R$ ${Math.abs(v).toFixed(2)}`, 188, y);
        } else {
            doc.setTextColor(0, 100, 0);
            doc.text(`R$ ${v.toFixed(2)}`, 188, y);
        }
        
        doc.setTextColor(40, 40, 40);
        doc.setDrawColor(240);
        doc.line(10, y + 2, 200, y + 2);
        y += 7;
    });

    // --- LINHA DE SOMA FINAL ---
    y += 3;
    doc.setFillColor(230, 230, 235);
    doc.rect(10, y - 5, 190, 8, 'F');
    doc.setFont("helvetica", "bold");
    doc.text("SOMA TOTAL DO PERÍODO:", 12, y);
    doc.text(`R$ ${taxaTotalAcumulada.toFixed(2)}`, 140, y);
    doc.text(`R$ ${lucroLiquido.toFixed(2)}`, 165, y);
    doc.text(`R$ ${lucroBruto.toFixed(2)}`, 188, y);

    // --- RODAPÉ ---
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text(`POWERED BY NEXODIGITAL - Página ${i} de ${pageCount}`, 85, 292);
    }

    doc.save(`RELATORIO_FINANCEIRO_${new Date().getTime()}.pdf`);
    showToast("Relatório Gerado com Sucesso!");
}


function atualizarVisual(servicos, produtos, saidas, periodoAtivo = 'hoje') {
    const segmentsContainer = document.getElementById('pizza-segments');
    if (!segmentsContainer) return;

    const total = servicos + produtos + saidas;
    segmentsContainer.innerHTML = ''; 

    const atualizarBarra = (idBar, idVal, valor) => {
        const p = total > 0 ? (valor / total) * 100 : 0;
        const elBar = document.getElementById(idBar);
        const elVal = document.getElementById(idVal);
        if(elBar) elBar.style.width = p + '%';
        if(elVal) elVal.innerText = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    atualizarBarra('bar-servicos', 'val-servicos', servicos);
    atualizarBarra('bar-produtos', 'val-produtos', produtos);
    atualizarBarra('bar-saidas', 'val-saidas', saidas);

    if (total === 0) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", "16"); circle.setAttribute("cx", "16"); circle.setAttribute("cy", "16");
        circle.setAttribute("fill", "#2d2d3f");
        segmentsContainer.appendChild(circle);
        return;
    }

    const pizzaDados = [
        { v: servicos, c: '#5d5fef', label: 'Cortes (Serviços)', tipo: 'servico', periodo: periodoAtivo },
        { v: produtos, c: '#c5a86d', label: 'Venda de Produtos', tipo: 'produto', periodo: periodoAtivo },
        { v: saidas, c: '#e74c3c', label: 'Despesas (Saídas)', tipo: 'saida', periodo: periodoAtivo }
    ];

    let accum = 0;
    pizzaDados.forEach(item => {
        if (item.v > 0) {
            const perc = (item.v / total) * 100;
            const slice = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            slice.setAttribute("r", "16"); slice.setAttribute("cx", "16"); slice.setAttribute("cy", "16");
            slice.setAttribute("fill", "none");
            slice.setAttribute("stroke", item.c);
            slice.setAttribute("stroke-width", "32");
            slice.setAttribute("stroke-dasharray", `${perc} 100`);
            slice.setAttribute("stroke-dashoffset", -accum);
            slice.style.cursor = "pointer";

            slice.onclick = (e) => {
                e.stopPropagation();
                preencherCardLateral(item);
            };
            segmentsContainer.appendChild(slice);
            accum += perc;
        }
    });
}


function preencherCardLateral(categoria) {
    const lista = document.getElementById('side-list');
    const cardVazio = document.getElementById('side-content-empty');
    const conteudo = document.getElementById('side-content-data');
    const titulo = document.getElementById('side-title');
    const contador = document.getElementById('side-count'); // Novo elemento
    const container = document.getElementById('side-details-card');

    if (!lista) return;

    if(cardVazio) cardVazio.style.display = 'none';
    if(conteudo) conteudo.style.display = 'flex'; 

    lista.innerHTML = '';

    // Estilização do Card
    container.style.border = `1px solid ${categoria.c}`;
    container.style.borderLeft = `5px solid ${categoria.c}`;
    titulo.innerText = categoria.label;
    titulo.style.color = categoria.c;

    const periodo = categoria.periodo || 'hoje';
    const agora = new Date();
    const hojeStr = agora.toLocaleDateString('pt-BR');

    // Filtro dinâmico
    const filtrados = sales.filter(item => {
        if (item.tipo !== categoria.tipo) return false;
        const d = new Date(item.data_venda);
        const dStr = d.toLocaleDateString('pt-BR');

        if (periodo === 'hoje') return dStr === hojeStr;
        if (periodo === 'ontem') {
            const ontem = new Date();
            ontem.setDate(agora.getDate() - 1);
            return dStr === ontem.toLocaleDateString('pt-BR');
        }
        if (periodo === 'semana') {
            const umaSemanaAtras = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
            return d >= umaSemanaAtras;
        }
        if (periodo === 'mes') {
            const primeiroDiaMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
            return d >= primeiroDiaMes;
        }
        return true;
    });

    // --- ATUALIZAÇÃO DINÂMICA DO CONTADOR ---
    if (contador) {
        contador.innerText = `${filtrados.length} lançamentos`;
        contador.style.borderColor = categoria.c;
    }

    if (filtrados.length === 0) {
        lista.innerHTML = `<p style="text-align:center; padding:20px; opacity:0.5; font-size:0.8rem;">Nenhum detalhe encontrado.</p>`;
        return;
    }

    // Ordenação e Renderização dos itens
    [...filtrados].sort((a, b) => new Date(b.data_venda) - new Date(a.data_venda)).forEach(item => {
        const valorAbs = Math.abs(parseFloat(item.valor) || 0);
        const d = new Date(item.data_venda);
        
        const itemDiv = document.createElement('div');
        itemDiv.style = `display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(255,255,255,0.05); border-radius:8px; margin-bottom:8px; border-left: 3px solid ${categoria.c}; flex-shrink: 0;`; 
        
        itemDiv.innerHTML = `
            <div style="display:flex; flex-direction:column;">
                <b style="color:white; font-size:0.85rem;">${item.item_nome}</b>
                <small style="color:#aaa; font-size:0.65rem;">${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</small>
            </div>
            <b style="color:${categoria.c}; font-size:0.9rem;">
                ${valorAbs.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </b>
        `;
        lista.appendChild(itemDiv);
    });
}


document.getElementById('main-search').addEventListener('input', function(e) {
    const termo = e.target.value.toLowerCase();
    document.querySelectorAll('.item-card').forEach(card => {
        const nome = card.querySelector('strong').innerText.toLowerCase();
        card.style.display = nome.includes(termo) ? "block" : "none";
    });
});


function showToast(msg) {
    const toast = document.createElement('div');
    toast.style = "position:fixed; bottom:20px; right:20px; background:var(--success); color:white; padding:15px 25px; border-radius:10px; z-index:1000; animation: fadeIn 0.3s;";
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}


function renderRecentSales() {
    const historyContainer = document.getElementById('recent-sales-list');
    if(!historyContainer) return;

    const recent = sales.filter(s => s.tipo !== 'saida').slice(-5).reverse();
    historyContainer.innerHTML = recent.map(s => `
        <div class="inventory-item" style="font-size:0.8rem">
            <span>${new Date(s.data_venda).toLocaleTimeString()} - ${s.item_nome}</span>
            <div style="display:flex; align-items:center; gap:10px">
                <strong style="color:var(--success)">
                    R$ ${Math.abs(s.valor).toFixed(2)}
                </strong>
                <button class="btn-icon del" onclick="deleteSale(${s.id})"><i class="fas fa-times"></i></button>
            </div>
        </div>
    `).join('');
}


function selectMethod(element, method) {
    document.querySelectorAll('.pay-btn').forEach(btn => btn.classList.remove('active'));
    element.classList.add('active');
    document.getElementById('paymentMethod').value = method;
}


async function deleteSale(id) {
    if(confirm("Estornar este lançamento do banco de dados?")) {
        const { error } = await _supabase.from('vendas').delete().eq('id', id);
        if(!error) await carregarDadosDoBanco();
    }
}

window.onload = init;


/* ===================================================== */
/* CONTROLE DO MENU MOBILE (CLIQUE + DESLIZE) */
/* ===================================================== */

document.addEventListener('DOMContentLoaded', () => {

    const hamburger = document.getElementById('hamburger');
    const menu = document.getElementById('mobileMenu');
    const overlay = document.getElementById('mobileOverlay');

    /* --------------------------------------------- */
    /* FUNÇÃO CENTRAL: ABRIR / FECHAR MENU            */
    /* --------------------------------------------- */
    function setMenuState(active) {
        if (active) {
            menu.classList.add('active');
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        } else {
            menu.classList.remove('active');
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    /* --------------------------------------------- */
    /* CLIQUE NO HAMBURGER                            */
    /* --------------------------------------------- */
    hamburger.addEventListener('click', () => {
        setMenuState(!menu.classList.contains('active'));
    });

    /* --------------------------------------------- */
    /* CLIQUE NO OVERLAY                              */
    /* --------------------------------------------- */
    overlay.addEventListener('click', () => {
        setMenuState(false);
    });

    /* --------------------------------------------- */
    /* SWIPE (TOQUE)                                 */
    /* --------------------------------------------- */
    let startX = 0;
    let startY = 0;

    window.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;

        const diffX = startX - endX;
        const diffY = Math.abs(startY - endY);
        const threshold = 60;

        // Ignora se o movimento foi mais vertical que horizontal
        if (diffY > 80) return;

        // ABRIR: swipe da borda direita para esquerda
        if (diffX > threshold && startX > window.innerWidth - 40) {
            setMenuState(true);
        }

        // FECHAR: swipe da esquerda para direita
        if (diffX < -threshold && menu.classList.contains('active')) {
            setMenuState(false);
        }
    }, { passive: true });

});

/* ===================================================== */
/* FUNÇÃO GLOBAL — BOTÕES DO MENU                        */
/* ===================================================== */

function showConfigSection(sectionId, element) {
    // Ativa visual da tab
    document.querySelectorAll('.tab-item').forEach(btn => btn.classList.remove('active'));
    element.classList.add('active');

    if (window.innerWidth <= 1199) {
        const adminSections = document.querySelectorAll('[data-admin-section]');

        adminSections.forEach(section => {
            const allowedTabs = section.dataset.adminSection.split(' ');

            // REGRA EXTRA: Se for a seção de botões e a tab for 'despesas', esconde.
            if (section.classList.contains('admin-actions-grid') && sectionId === 'despesas') {
                section.style.display = 'none';
            } 
            // Lógica padrão que você já usa
            else if (allowedTabs.includes(sectionId)) {
                section.style.display = 'grid';
            } else {
                section.style.display = 'none';
            }
        });
    }
}


// --- FUNÇÃO DE CONTAGEM DO PAINEL ---
function updateAdminStats() {
    // 1. Conta os itens nas listas
    const nServicos = document.querySelectorAll('#list-servicos .inventory-item').length;
    const nProdutos = document.querySelectorAll('#list-produtos .inventory-item').length;
    const listaD = document.getElementById('list-despesas');
    const nDespesas = listaD ? listaD.children.length : 0;

    // 2. Atualiza os números nos visores (count-...)
    const vS = document.getElementById('count-servicos');
    const vP = document.getElementById('count-produtos');
    const vD = document.getElementById('count-despesas');

    if (vS) vS.innerText = nServicos;
    if (vP) vP.innerText = nProdutos;
    if (vD) vD.innerText = nDespesas;
}


// Criar um observador para atualizar em tempo real sem precisar de setInterval
const adminObserver = new MutationObserver(updateAdminStats);


// Inicia a observação assim que o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    updateAdminStats();
    
    // Lista de IDs que o observador deve vigiar
    const containers = ['list-servicos', 'list-produtos', 'list-despesas'];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) adminObserver.observe(el, { childList: true, subtree: true });
    });
});


// Melhora a função global de troca de Abas principais (Vendas/Admin)
function openMobileTab(tab) {
    if (typeof switchTab === 'function') {
        switchTab(tab);
    }

    // Fecha menu e overlay
    const menu = document.getElementById('mobileMenu');
    const overlay = document.getElementById('mobileOverlay');
    if(menu) menu.classList.remove('active');
    if(overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';

    // Lógica para mostrar/esconder a Tab Bar do Admin
    if (tab === 'admin') {
        document.body.classList.add('admin-active');
        // Ao abrir o admin, força a primeira aba (Novo Item) a ficar ativa
        const firstTab = document.querySelector('.tab-item');
        showConfigSection('novo-item', firstTab);
    } else {
        document.body.classList.remove('admin-active');
    }
}


function openModal(id) {
    console.log("Tentando abrir o modal:", id);
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'flex';
    } else {
        console.error("Erro: Modal com ID '" + id + "' não encontrado no HTML!");
    }
}


function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'none';
    }
}


// Fecha ao clicar no fundo
window.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
    }
});


// Clique para expandir/recolher a lista no Mobile
document.querySelector('.display-header').addEventListener('click', () => {
    if (window.innerWidth <= 768) {
        const list = document.getElementById('display-items-list');
        list.style.display = list.style.display === 'none' ? 'flex' : 'none';
    }
});


