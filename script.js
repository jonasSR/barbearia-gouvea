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


// 2. Controla a seleção visual dos botões de pagamento no modal
function selectMethod(element, method) {
    // Remove a classe 'active' de todos os botões do grid
    document.querySelectorAll('.pay-btn').forEach(btn => btn.classList.remove('active'));
    
    // Adiciona ao que foi clicado
    element.classList.add('active');
    
    // Atualiza o input hidden que o executeSale() lê
    document.getElementById('paymentMethod').value = method;
}


// --- NAVEGAÇÃO ENTRE ABAS ---
function switchTab(tabId) {
    // Esconde todos
    document.querySelectorAll('.tab-content').forEach(t => {
        t.classList.remove('active');
        t.style.display = 'none'; // Garante que fiquem invisíveis
    });
    
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    // Mostra o selecionado
    const target = document.getElementById(tabId);
    if(target) {
        target.classList.add('active');
        target.style.display = 'block'; // Força a aparição
    }
    
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }

    if(tabId === 'stats') updateReports();
}


// --- GESTÃO DO CATÁLOGO (NUVEM) ---
async function addItem() {
    const elName = document.getElementById('itemName');
    const elPrice = document.getElementById('itemPrice');
    const elType = document.getElementById('itemType');

    // 1. Limpeza do preço (converte a máscara de moeda para número decimal)
    const precoTexto = elPrice.value;
    const precoNumerico = parseFloat(precoTexto.replace(/[^\d,]/g, '').replace(',', '.'));

    // 2. Lógica para diferenciar Snack no Banco
    // Pega o texto visível do select para garantir que identifique "Snacks"
    const tipoTextoVisual = elType.options[elType.selectedIndex].text;
    let tipoFinal = elType.value;

    if (tipoTextoVisual.toLowerCase().includes('snack')) {
        tipoFinal = 'produto (snack)';
    }

    // 3. Validação básica
    if (!elName.value || isNaN(precoNumerico)) {
        alert("Preencha o nome e o preço corretamente.");
        return;
    }

    // 4. Envio para o banco de dados
    const { error } = await _supabase
        .from('itens_catalogo')
        .insert([{ 
            nome: elName.value, 
            preco: precoNumerico, 
            tipo: tipoFinal 
        }]);

    // Lembrete: Taxas de imposto são mantidas conforme suas instruções originais.

    if (error) {
        console.error("Erro ao salvar:", error.message);
        alert("Erro ao salvar no banco de dados.");
    } else {
        // Limpa os campos e atualiza a lista
        elName.value = '';
        elPrice.value = '';
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
        const isServico = item.tipo === 'servico';
        // Ajustado para identificar se é produto comum ou snack
        const isProdutoNormal = item.tipo === 'produto';
        const isSnack = item.tipo.includes('snack');

        const icone = isServico ? 'fa-cut' : 'fa-box';

        const cardHtml = `
            <div class="item-card" onclick="makeSale(${item.preco}, '${item.nome}', '${item.tipo}')">
                <i class="fas ${icone}" style="font-size: 1.5rem; color: var(--accent); margin-bottom: 10px;"></i>
                <strong>${item.nome}</strong>
                <span>R$ ${parseFloat(item.preco).toFixed(2)}</span>
            </div>
        `;

        // Renderiza no Grid: Agora ignora os snacks aqui
        if(isServico && gridServicos) {
            gridServicos.innerHTML += cardHtml;
        } else if(isProdutoNormal && gridProdutos) {
            gridProdutos.innerHTML += cardHtml;
        }

        const classeCor = isServico ? 'item-servico' : 'item-produto';

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

        // No Admin (Estoque), continua aparecendo tudo normalmente
        if(isServico && listServicosAdmin) {
            listServicosAdmin.innerHTML += adminItemHtml;
        } else if((isProdutoNormal || isSnack) && listProdutosAdmin) {
            listProdutosAdmin.innerHTML += adminItemHtml;
        }
    });

    if(document.getElementById('count-servicos')) 
        document.getElementById('count-servicos').innerText = catalog.filter(i => i.tipo === 'servico').length;
    if(document.getElementById('count-produtos')) 
        document.getElementById('count-produtos').innerText = catalog.filter(i => i.tipo.includes('produto')).length;

    atualizarSaldoCaixa();
    renderRecentSales();
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


async function carregarDadosDoBanco() {
    try {
        const [resCatalog, resVendas, resDespesas] = await Promise.all([
            _supabase.from('itens_catalogo').select('*'),
            _supabase.from('vendas').select('*'),
            _supabase.from('despesas').select('*')
        ]);

        // Removi os "throws" que forçavam a ida para o Alerta
        catalog = resCatalog.data || [];

        const despesasFormatadas = (resDespesas.data || []).map(d => ({
            id: d.id,
            item_nome: d.descricao || "Despesa sem nome",
            valor: Math.abs(parseFloat(d.valor || 0)),
            tipo: 'saida',
            data_venda: d.data_pagamento,
            metodo_pagamento: d.metodo_pagamento,
            valor_taxa: 0 
        }));

        sales = [...(resVendas.data || []), ...despesasFormatadas];

        updateUI();
        updateReports();
        
        if (typeof atualizarSaldoCaixa === 'function') {
            atualizarSaldoCaixa();
        }
        
        if (typeof renderDespesas === 'function') {
            renderDespesas();
        }

    } catch (err) {
        // O erro agora só aparece aqui no log interno, sem janela de Alerta para o usuário
        console.error("Silenciando erro de carregamento:", err);
    }
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


function mascaraMoeda(campo) {
    // Remove tudo que não é dígito
    let valor = campo.value.replace(/\D/g, "");
    
    // Faz o cálculo para ter sempre duas casas decimais
    valor = (valor / 100).toFixed(2) + "";
    
    // Inverte o ponto por vírgula para o padrão brasileiro
    valor = valor.replace(".", ",");
    
    // Adiciona o ponto de milhar
    valor = valor.replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1.");
    
    campo.value = valor;
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
                    R$ ${Math.abs(d.valor).toFixed(2)}
                </span>

                <div class="item-actions">
                    <button class="icon-btn" onclick='prepararEdicaoDespesa(${JSON.stringify(d)})'>
                        <i class="fas fa-pen"></i>
                    </button>

                    <button class="icon-btn danger" onclick="deleteDespesa(${d.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}


async function deleteDespesa(id) {
    if (confirm("Deseja realmente excluir esta despesa permanentemente?")) {
        const { error } = await _supabase
            .from('despesas') // Tabela correta conforme sua imagem
            .delete()
            .eq('id', id);

        if (error) {
            console.error("Erro ao deletar despesa:", error);
            alert("Erro ao excluir do banco de dados.");
        } else {
            await carregarDadosDoBanco();
            if (typeof showToast === 'function') showToast("Despesa removida!");
        }
    }
}


function prepararEdicaoDespesa(item) {
    // 1. Preenche o ID
    document.getElementById('editItemId').value = item.id;
    
    // 2. BUSCA O NOME: Tenta todas as variações possíveis que seu banco pode ter
    // Verifique se no seu banco é 'descricacao' ou 'descricao'
    const nomeDaDespesa = item.descricacao || item.descricao || item.item_nome || "";
    document.getElementById('editItemName').value = nomeDaDespesa;
    
    // 3. Preenche o VALOR
    document.getElementById('editItemPrice').value = Math.abs(item.valor) || 0;
    
    // 4. Lida com o campo de TIPO (Select)
    const selectTipo = document.getElementById('editItemType');
    if (selectTipo) {
        if (![...selectTipo.options].some(o => o.value === 'saida')) {
            const opt = document.createElement('option');
            opt.value = 'saida';
            opt.text = 'Despesa';
            selectTipo.add(opt);
        }
        selectTipo.value = 'saida';
        selectTipo.disabled = true; // Trava o campo conforme pedido
    }

    // 5. Configura o botão salvar
    const btnSalvar = document.querySelector('#editModal .btn-confirm');
    if (btnSalvar) {
        btnSalvar.setAttribute('onclick', 'saveEditDespesa()');
    }

    // 6. Abre o modal
    const modal = document.getElementById('editModal');
    if (modal) modal.style.display = 'flex';
}


async function saveEditDespesa() {
    // 1. Pega os valores do modal
    const id = Number(document.getElementById('editItemId').value);
    const name = document.getElementById('editItemName').value;
    const price = parseFloat(document.getElementById('editItemPrice').value);

    console.log("Salvando na tabela DESPESAS - ID:", id);

    // 2. Atualiza na tabela correta: 'despesas'
    const { error, data } = await _supabase
        .from('despesas') // Alterado de 'vendas' para 'despesas' conforme sua imagem
        .update({ 
            descricao: name, // Alterado de 'item_nome' para 'descricao' conforme sua imagem
            valor: price     // Na sua tabela 'despesas', o valor parece ser armazenado positivo
        })
        .eq('id', id)
        .select(); 

    if (error) {
        console.error("Erro Supabase:", error);
        alert("Erro ao atualizar despesa: " + error.message);
    } else if (data && data.length === 0) {
        console.warn("Nenhum registro encontrado com ID:", id);
        alert("Erro: Item não encontrado no banco.");
    } else {
        console.log("Sucesso!", data);
        
        // 3. Fecha e limpa
        closeEditModal();
        await carregarDadosDoBanco();
        if (typeof showToast === 'function') showToast("Despesa atualizada!");

        // Restaura o botão para a função original
        const btnSalvar = document.querySelector('#editModal .btn-confirm');
        if (btnSalvar) btnSalvar.setAttribute('onclick', 'saveEdit()');
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


// --- RELATÓRIOS E PDF (CORREÇÃO DEFINITIVA) ---
async function updateReports(periodo = 'hoje', btn = null) { // Adicionado async para buscar do banco
    if (btn) {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    // --- BUSCA DE DADOS DOS CLIENTES PREMIUM ---
    const { data: mensalistas } = await _supabase.from('clientes_premium').select('*');
    window.dadosPremiumGlobal = mensalistas;

    const now = new Date();
    const todayStr = now.toLocaleDateString('pt-BR');
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const firstDayMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Adicionado o campo extra e snack aqui
    let statsFiltro = { bruto: 0, liquido: 0, taxas: 0, exp: 0, serv: 0, prod: 0, extra: 0, snack: 0, premium: 0 };
    let stats = {
        todayGross: 0, todayNet: 0, todayExp: 0, week: 0,
        monthGross: 0, monthExp: 0,
        servicos: 0, produtos: 0, totalDespesasGerais: 0
    };

    const totalsByDay = {};

    // --- PROCESSAMENTO DAS VENDAS NORMAIS (EXISTENTE) ---
    sales.forEach(sale => {
        const d = new Date(sale.data_venda || sale.data_pagamento);
        const dStr = d.toLocaleDateString('pt-BR');
        
        const valBruto = parseFloat(sale.valor) || 0;
        
        // CORREÇÃO: Se for saída, valor_taxa é SEMPRE 0.
        const valTaxa = sale.tipo === 'saida' ? 0 : (parseFloat(sale.valor_taxa) || 0);
        const valLiquido = valBruto - valTaxa;

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
                if (sale.tipo === 'extra') statsFiltro.extra += valBruto; 
                if (sale.tipo === 'produto (snack)') statsFiltro.snack += valBruto; // Acréscimo do Snack conforme banco
            } else {
                statsFiltro.exp += Math.abs(valBruto);
            }
        }
    });

    // --- PROCESSAMENTO DOS CLIENTES PREMIUM (NOVA INTEGRAÇÃO) ---
    if (mensalistas) {
        mensalistas.forEach(m => {
            const d = new Date(m.data_inicio + 'T00:00:00');
            const dStr = d.toLocaleDateString('pt-BR');
            const valBruto = parseFloat(m.plano_valor) || 0;
            const valTaxa = parseFloat(m.valor_desconto) || 0;
            const valLiquido = parseFloat(m.valor_liquido) || (valBruto - valTaxa);

            // Adiciona ao histórico diário
            totalsByDay[dStr] = (totalsByDay[dStr] || 0) + valLiquido;

            // Stats hoje
            if (dStr === todayStr) {
                stats.todayGross += valBruto;
                stats.todayNet += valLiquido;
            }
            // Stats Semana/Mês
            if (d >= oneWeekAgo) stats.week += valBruto;
            if (d >= firstDayMonth) stats.monthGross += valBruto;

            // Filtro de período da tela
            let incluirNoFiltro = false;
            if (periodo === 'hoje' && dStr === todayStr) incluirNoFiltro = true;
            else if (periodo === 'semana' && d >= oneWeekAgo) incluirNoFiltro = true;
            else if (periodo === 'mes' && d >= firstDayMonth) incluirNoFiltro = true;

            if (incluirNoFiltro) {
                statsFiltro.bruto += valBruto;
                statsFiltro.liquido += valLiquido;
                statsFiltro.taxas += valTaxa;
                statsFiltro.premium += valBruto; // Categoria específica para mensalistas
            }
        });
    }

// --- ATUALIZAÇÃO DA UI (CARD FECHAMENTO) ---
    const liquidoCard1 = statsFiltro.bruto - statsFiltro.taxas;

    if(document.getElementById('today-net')) {
        document.getElementById('today-net').innerText = `R$ ${liquidoCard1.toFixed(2)}`;
        document.getElementById('today-gross-val').innerText = `R$ ${statsFiltro.bruto.toFixed(2)}`;
        document.getElementById('today-expense-val').innerText = `R$ ${statsFiltro.taxas.toFixed(2)}`;
    }
    
    // Atualiza o card de destaque do Premium
    if(document.getElementById('premium-total-val')) {
        document.getElementById('premium-total-val').innerText = `R$ ${statsFiltro.premium.toFixed(2)}`;
    }
    
    if(document.getElementById('month-expenses-val')) {
        document.getElementById('month-expenses-val').innerText = `R$ ${statsFiltro.exp.toFixed(2)}`;
    }
    
    const cashEl = document.getElementById('cash-balance');
    if (cashEl) cashEl.innerText = `R$ ${stats.todayGross.toFixed(2)}`;

    const weekTotalElem = document.getElementById('week-total');
        if (weekTotalElem) {
            weekTotalElem.innerText = `R$ ${stats.week.toFixed(2)}`;
        }
    document.getElementById('month-total-val').innerText = `R$ ${stats.monthGross.toFixed(2)}`;

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

    // Agora enviando os valores para o gráfico com o Premium como parâmetro individual
    atualizarVisual(
        statsFiltro.serv, 
        statsFiltro.prod, 
        statsFiltro.exp, 
        statsFiltro.extra, 
        statsFiltro.snack, 
        statsFiltro.premium, 
        periodo
    );
}


// --- FUNÇÃO DE EXPORTAR PDF (COM TAXAS, TOTAIS E FECHAMENTOS DIÁRIOS) ---
async function exportarRelatorioPDF(modo = 'geral') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // --- LÓGICA DE FILTRAGEM E VALIDAÇÃO ---
    let vendasFiltradas = [...sales]; 

    // BUSCA DE DADOS DOS CLIENTES PREMIUM
    const { data: mensalistas } = await _supabase.from('clientes_premium').select('*');
    

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
    let totalBarba = 0, totalPezinho = 0, totalSobrancelha = 0;
    
    const metodos = {};
    const rankingItens = { servicos: {}, produtos: {} };
    const fechamentosDiarios = {}; 

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
        const nomeBusca = nomeItem.toLowerCase();
        const dataDia = new Date(s.data_venda).toLocaleDateString('pt-BR');

        if (!fechamentosDiarios[dataDia]) {
            fechamentosDiarios[dataDia] = { entradas: 0, saidas: 0, taxas: 0, qtd: 0 };
        }

        if (s.tipo !== 'saida') {
            qtdVendas++;
            taxaTotalAcumulada += tx;
            fechamentosDiarios[dataDia].entradas += v;
            fechamentosDiarios[dataDia].taxas += tx;
            fechamentosDiarios[dataDia].qtd++;

            if (nomeBusca.includes("barba")) totalBarba++;
            if (nomeBusca.includes("pezinho")) totalPezinho++;
            if (nomeBusca.includes("sobrancelha") || nomeBusca.includes("sombrancelha")) totalSobrancelha++;

            if (s.tipo === 'servico' || s.tipo === 'extra') {
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
    doc.text(`Total de Barbas: ${totalBarba} | Total de Pesinhos: ${totalPezinho} | Total de Sombrancelhas: ${totalSobrancelha}`, 15, 76);
    doc.text(`Total de Produtos: ${qtdProdutos} | Mais vendido: ${topProduto}`, 15, 71);

    doc.setFontSize(10);
    doc.text(`Faturamento (Serviços): R$ ${servTotal.toFixed(2)}`, 15, 84);
    doc.text(`Faturamento (Produtos): R$ ${prodTotal.toFixed(2)}`, 15, 90);
    doc.text(`Atendimentos: ${qtdVendas}`, 120, 84);
    doc.text(`Ticket Médio: R$ ${ticketMedio.toFixed(2)}`, 120, 90);

    doc.setFont("helvetica", "bold");
    doc.text(`LUCRO BRUTO: R$ ${lucroBruto.toFixed(2)}`, 15, 99);
    doc.setTextColor(200, 0, 0);
    doc.text(`TAXAS: R$ ${taxaTotalAcumulada.toFixed(2)}`, 85, 99);
    doc.text(`DESPESAS: R$ ${expTotal.toFixed(2)}`, 145, 99);

    doc.setFillColor(245, 245, 250);
    doc.rect(15, 104, 180, 12, 'F');
    doc.setTextColor(lucroLiquido >= 0 ? 0 : 200, 100, 0);
    doc.setFontSize(14);
    doc.text(`LUCRO LÍQUIDO FINAL: R$ ${lucroLiquido.toFixed(2)}`, 60, 112);

    // --- MÉTODOS DE PAGAMENTO ---
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("ENTRADAS POR MÉTODO E TAXAS", 15, 129);
    let yM = 139;
    Object.keys(metodos).forEach(m => {
        const taxaTexto = infoTaxas[m] ? `(${infoTaxas[m]})` : "";
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.text(`${m} ${taxaTexto}: ${metodos[m].qtd}x - Total Bruto: R$ ${metodos[m].valor.toFixed(2)}`, 20, yM);
        yM += 6;
    });

    // --- BLOCO: LISTA DE CLIENTES PREMIUM ---
    let somaBrutoPremium = 0;
    let somaLiquidoPremium = 0;

    if (mensalistas && mensalistas.length > 0) {
        doc.setTextColor(40, 40, 40);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text("LISTA DE CLIENTES PREMIUM", 15, yM + 10);

        let yP = yM + 20;
        doc.setFillColor(45, 45, 63);
        doc.rect(10, yP - 5, 190, 8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(5.5);

        doc.text("CRIADO EM", 12, yP);
        doc.text("NOME", 28, yP);
        doc.text("TELEFONE", 50, yP);
        doc.text("INÍCIO", 73, yP);
        doc.text("VENCIMENTO", 88, yP);
        doc.text("MÉTODO", 110, yP);
        doc.text("STATUS", 132, yP);
        doc.text("BRUTO", 152, yP);
        doc.text("LÍQUIDO", 170, yP);
        doc.text("DESC.", 188, yP);

        yP += 8;
        doc.setTextColor(40, 40, 40);
        doc.setFont("helvetica", "normal");

        mensalistas.forEach(m => {
            if (yP > 275) { doc.addPage(); yP = 25; }
            
            const criado = m.criado_em ? new Date(m.criado_em).toLocaleDateString('pt-BR') : "---";
            const inicio = m.data_inicio ? new Date(m.data_inicio).toLocaleDateString('pt-BR') : "---";
            const venc = m.data_vencimento ? new Date(m.data_vencimento).toLocaleDateString('pt-BR') : "---";
            const statusCor = m.status === 'ATIVO' ? [0, 120, 0] : [200, 0, 0];

            somaBrutoPremium += parseFloat(m.plano_valor || 0);
            somaLiquidoPremium += parseFloat(m.valor_liquido || 0);

            doc.setFontSize(5.5);
            doc.text(criado, 12, yP);
            doc.text((m.nome || "---").toUpperCase().substring(0, 10), 28, yP);
            doc.text(m.telefone || "---", 50, yP);
            doc.text(inicio, 73, yP);
            doc.text(venc, 88, yP);
            doc.text((m.metodo_pagamento || "---").substring(0, 10), 110, yP);
            
            doc.setTextColor(statusCor[0], statusCor[1], statusCor[2]);
            doc.setFont("helvetica", "bold");
            doc.text(m.status || "---", 132, yP);
            
            doc.setTextColor(40, 40, 40);
            doc.setFont("helvetica", "normal");
            doc.text(parseFloat(m.plano_valor || 0).toFixed(2), 152, yP);
            doc.text(parseFloat(m.valor_liquido || 0).toFixed(2), 170, yP);
            doc.text(parseFloat(m.valor_desconto || 0).toFixed(2), 188, yP);
            
            doc.setDrawColor(240);
            doc.line(10, yP + 2, 200, yP + 2);
            yP += 7;
        });
        yM = yP; 
    }

    // --- BLOCO: FECHAMENTOS DIÁRIOS ---
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

    // --- LISTAGEM ANALÍTICA DETALHADA ---
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

    // --- LINHA DE SOMA TOTAL DO PERÍODO (CINZA) ---
    y += 3;
    doc.setFillColor(230, 230, 235);
    doc.rect(10, y - 5, 190, 8, 'F');
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(40, 40, 40);

    doc.text("SOMA TOTAL DO PERÍODO:", 12, y);
    doc.text(`TAXAS: R$ ${taxaTotalAcumulada.toFixed(2)}`, 115, y); // Mais para a esquerda
    doc.text(`LIQ: R$ ${lucroLiquido.toFixed(2)}`, 145, y);   // Espaço maior
    doc.text(`BRUTO: R$ ${lucroBruto.toFixed(2)}`, 175, y); // Longe da borda

    // --- NOVA LINHA: SOMA TOTAL CLIENTES PREMIUM (AZUL ESCURO) ---
    y += 10;
    doc.setFillColor(230, 230, 235); 
    doc.rect(10, y - 5, 190, 8, 'F');
    doc.setTextColor(40, 40, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);

    doc.text("SOMA TOTAL CLIENTES PREMIUM:", 12, y);
    // Alinhando os valores premium exatamente abaixo dos valores de cima
    doc.text(`LÍQUIDO: R$ ${somaLiquidoPremium.toFixed(2)}`, 145, y); 
    doc.text(`BRUTO: R$ ${somaBrutoPremium.toFixed(2)}`, 175, y);

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


function atualizarVisual(servicos, produtos, saidas, extras = 0, snacks = 0, premium = 0, periodoAtivo = 'hoje') {
    // Caso a função receba 'hoje' no lugar do número (segurança), ajustamos
    if (typeof extras === 'string') {
        periodoAtivo = extras;
        extras = 0;
        snacks = 0;
        premium = 0;
    }
    if (typeof snacks === 'string') {
        periodoAtivo = snacks;
        snacks = 0;
        premium = 0;
    }
    if (typeof premium === 'string') {
        periodoAtivo = premium;
        premium = 0;
    }

    const segmentsContainer = document.getElementById('pizza-segments');
    if (!segmentsContainer) return;

    // O total agora inclui os extras, snacks e os novos Clientes Premium
    const total = servicos + produtos + saidas + extras + snacks + premium;
    segmentsContainer.innerHTML = ''; 

    const atualizarBarra = (idBar, idVal, valor) => {
        const p = total > 0 ? (valor / total) * 100 : 0;
        const elBar = document.getElementById(idBar);
        const elVal = document.getElementById(idVal);
        if(elBar) elBar.style.width = p + '%';
        if(elVal) elVal.innerText = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    // Atualiza todas as barras, incluindo a nova 'bar-premium'
    atualizarBarra('bar-servicos', 'val-servicos', servicos);
    atualizarBarra('bar-produtos', 'val-produtos', produtos);
    atualizarBarra('bar-saidas', 'val-saidas', saidas);
    atualizarBarra('bar-extras', 'val-extras', extras);
    atualizarBarra('bar-snacks', 'val-snacks', snacks);
    atualizarBarra('bar-premium', 'val-premium', premium);

    // Atualiza o card de destaque dos Clientes Premium que vimos na imagem
    const elPremiumTotal = document.getElementById('premium-total-val');
    if(elPremiumTotal) elPremiumTotal.innerText = premium.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    if (total === 0) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", "16"); circle.setAttribute("cx", "16"); circle.setAttribute("cy", "16");
        circle.setAttribute("fill", "#2d2d3f");
        segmentsContainer.appendChild(circle);
        return;
    }

    // Adicionado o objeto do premium na lista da pizza (cor roxa para destacar)
    const pizzaDados = [
        { v: servicos, c: '#5d5fef', label: 'Cortes (Serviços)', tipo: 'servico', periodo: periodoAtivo },
        { v: produtos, c: '#c5a86d', label: 'Venda de Produtos', tipo: 'produto', periodo: periodoAtivo },
        { v: snacks, c: '#ff7f50', label: 'Produtos (Snacks)', tipo: 'produto (snack)', periodo: periodoAtivo },
        { v: premium, c: '#8e44ad', label: 'Clientes Premium', tipo: 'premium', periodo: periodoAtivo },
        { v: saidas, c: '#e74c3c', label: 'Despesas (Saídas)', tipo: 'saida', periodo: periodoAtivo },
        { v: extras, c: '#d4af37', label: 'Serviços Extras', tipo: 'extra', periodo: periodoAtivo }
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
    
    const titulo = document.querySelector('#side-content-data h3'); 
    const contador = document.getElementById('side-count'); 
    const container = document.getElementById('side-details-card');

    if (!lista) return;

    if(cardVazio) cardVazio.style.display = 'none';
    if(conteudo) conteudo.style.display = 'flex'; 

    lista.innerHTML = '';

    if (titulo) {
        titulo.innerText = categoria.label.toUpperCase();
        titulo.style.color = categoria.c;
    }

    if (container) {
        container.style.border = `1px solid ${categoria.c}`;
        container.style.borderLeft = `5px solid ${categoria.c}`;
    }

    const periodo = categoria.periodo || 'hoje';
    const agora = new Date();
    const hojeStr = agora.toLocaleDateString('pt-BR');

    const TAXA_PRODUTO = 0.15; 
    const TAXA_SERVICO = 0.05; 

    let filtrados = [];

    // --- LÓGICA PARA CLIENTES PREMIUM ---
    if (String(categoria.tipo).toLowerCase() === 'premium') {
        // Usamos a global para evitar conflito com o ID do HTML
        const dadosDestaTabela = window.dadosPremiumGlobal || [];
        
        filtrados = dadosDestaTabela.filter(m => {
            // Ajuste manual de data para evitar erros de fuso horário
            const partes = m.data_inicio.split('-');
            const dStr = `${partes[2]}/${partes[1]}/${partes[0]}`;
            const dObjeto = new Date(m.data_inicio + 'T12:00:00');

            if (periodo === 'hoje') return dStr === hojeStr;
            if (periodo === 'ontem') {
                const ontem = new Date();
                ontem.setDate(agora.getDate() - 1);
                return dStr === ontem.toLocaleDateString('pt-BR');
            }
            if (periodo === 'semana') {
                const umaSemanaAtras = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
                return dObjeto >= umaSemanaAtras;
            }
            if (periodo === 'mes') {
                const primeiroDiaMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
                return dObjeto >= primeiroDiaMes;
            }
            return true;
        }).map(m => ({
            item_nome: (m.nome || 'ASSINATURA PREMIUM').toUpperCase(),
            valor_final: parseFloat(m.valor_liquido || m.plano_valor || 0),
            data_venda: m.data_inicio + 'T12:00:00',
            tipo: 'premium'
        }));
    } else {
        // --- LÓGICA PARA VENDAS NORMAIS ---
        filtrados = sales.filter(item => {
            const tipoNoBanco = String(item.tipo).toLowerCase();
            const tipoSelecionado = String(categoria.tipo).toLowerCase();
            if (!tipoNoBanco.includes(tipoSelecionado)) return false;

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
        }).map(item => {
            const valorOriginal = Math.abs(parseFloat(item.valor) || 0);
            const eServico = String(item.tipo).toLowerCase().includes('servico') || String(item.tipo).toLowerCase().includes('serviço');
            const taxa = eServico ? TAXA_SERVICO : TAXA_PRODUTO;
            return { ...item, valor_final: valorOriginal * (1 - taxa) };
        });
    }

    if (contador) {
        contador.innerText = `${filtrados.length} lançamentos`;
        contador.style.borderColor = categoria.c;
    }

    if (filtrados.length === 0) {
        lista.innerHTML = `<p style="text-align:center; padding:20px; opacity:0.5; font-size:0.8rem;">Nenhum detalhe encontrado.</p>`;
        return;
    }

    [...filtrados].sort((a, b) => new Date(b.data_venda) - new Date(a.data_venda)).forEach(item => {
        const d = new Date(item.data_venda);
        const itemDiv = document.createElement('div');
        itemDiv.style = `display:flex; justify-content:space-between; align-items:center; padding:12px 15px; background:rgba(255,255,255,0.05); border-radius:12px; margin-bottom:10px; border-left: 4px solid ${categoria.c};`; 
        
        itemDiv.innerHTML = `
            <div style="display:flex; flex-direction:column; gap: 4px;">
                <b style="color:white; font-size:0.9rem;">${item.item_nome}</b>
                <small style="color:#888; font-size:0.7rem;">${d.toLocaleDateString('pt-BR')} ${item.tipo !== 'premium' ? 'às ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : ''}</small>
            </div>
            <b style="color:${categoria.c}; font-size:1rem;">
                ${item.valor_final.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
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


/* CONTROLE DO MENU MOBILE (CLIQUE + DESLIZE) */
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


/* FUNÇÃO GLOBAL — BOTÕES DO MENU */
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


function abrirServicoExtra() {
    // Reset inicial com taxas preservadas
    pendingSale = { name: "", price: 0, type: 'extra' };

    const preview = document.getElementById('salePreview');
    if (preview) {
        preview.innerHTML = `
            <div id="containerSelecao">
                <p style="margin:0 0 15px 0; color:#888; font-size:0.7rem; text-transform:uppercase; text-align:center;">Selecione o Serviço</p>
                <div class="opcoes-servico">
                    <div class="opcao-item" onclick="definirNomeServico('PLATINADO')">PLATINADO</div>
                    <div class="opcao-item" onclick="definirNomeServico('LUZES')">LUZES</div>
                    <div class="opcao-item" onclick="definirNomeServico('ALISAMENTO')">ALISAMENTO</div>
                </div>
            </div>

            <div id="areaValorManual" style="display:none; animation: fadeIn 0.3s ease;">
                <input type="text" id="manualExtraNameDisplay" class="input-nome-selecionado" readonly>
                
                <label style="display:block; color:#888; font-size:0.6rem; margin-bottom:5px; text-align:center;">DIGITE O VALOR (R$)</label>
                <input type="tel" id="manualExtraValue" 
                       style="width:100%; background:transparent; border:1px solid #d4af37; color:white; font-size:2.5rem; padding:15px; border-radius:12px; text-align:center; font-weight:bold; outline: none;" 
                       placeholder="0,00">
            </div>
        `;
    }

    document.getElementById('confirmSaleModal').style.display = 'flex';
}


function definirNomeServico(nome) {
    const conteinerSelecao = document.getElementById('containerSelecao');
    const areaValor = document.getElementById('areaValorManual');
    const inputNomeDisplay = document.getElementById('manualExtraNameDisplay');
    const inputValue = document.getElementById('manualExtraValue');

    // Define o nome no objeto global de venda
    pendingSale.name = nome;
    inputNomeDisplay.value = nome;

    // Troca as telas na modal
    conteinerSelecao.style.display = 'none';
    areaValor.style.display = 'block';

    // Foca no valor automaticamente
    inputValue.focus();

    // Máscara de dinheiro manual (Mantém preço real para taxas)
    inputValue.addEventListener('input', function() {
        let val = this.value.replace(/\D/g, '');
        if (val === "") val = "0";
        val = (val / 100).toFixed(2);
        this.value = val.replace(".", ",");
        
        // Atribui ao objeto para cálculo de taxas e impostos posterior
        pendingSale.price = parseFloat(val);
    });
}


function abrirProdutoSnack() {
    // Reset inicial
    pendingSale = { name: "", price: 0, type: 'produto (snack)' };

    const preview = document.getElementById('salePreview');
    if (preview) {
        // Criamos o container para os botões dos snacks
        preview.innerHTML = `
            <p style="margin:0 0 15px 0; color:#888; font-size:0.7rem; text-transform:uppercase; text-align:center;">Selecione o Snack</p>
            <div id="gridSnacksModal" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; max-height:300px; overflow-y:auto; padding:5px;">
                </div>
        `;

        const grid = document.getElementById('gridSnacksModal');
        
        // Filtra o catálogo buscando apenas o que é 'produto (snack)' no banco
        const snacksDoBanco = catalog.filter(item => item.tipo === 'produto (snack)');

        if (snacksDoBanco.length === 0) {
            grid.innerHTML = `<p style="grid-column:span 2; color:#555; font-size:0.8rem; text-align:center;">Nenhum snack encontrado no banco.</p>`;
        }

        // Gera os botões dinamicamente
        snacksDoBanco.forEach(snack => {
            const btn = document.createElement('div');
            btn.className = 'opcao-item'; // Usa o seu estilo de "Platinado/Luzes"
            btn.style.padding = "10px";
            btn.style.height = "auto";
            btn.style.display = "flex";
            btn.style.flexDirection = "column";
            btn.style.gap = "5px";
            
            btn.onclick = () => {
                // Ao clicar, ele preenche a venda pendente com os dados reais do banco
                pendingSale.name = snack.nome;
                pendingSale.price = snack.preco;
                pendingSale.type = snack.tipo;
                
                // Mostra o que foi selecionado no lugar da lista
                preview.innerHTML = `
                    <p style="margin:0; color:#888;">Item selecionado:</p>
                    <h2 style="margin:10px 0; color:white;">${snack.nome}</h2>
                    <p style="margin:0; font-size:1.8rem; color:#d4af37; font-weight:bold;">R$ ${parseFloat(snack.preco).toFixed(2)}</p>
                    <button onclick="abrirProdutoSnack()" style="margin-top:15px; background:transparent; border:none; color:#555; cursor:pointer; font-size:0.7rem;">← Voltar aos snacks</button>
                `;
            };

            btn.innerHTML = `
                <b style="font-size:0.8rem; color:white;">${snack.nome}</b>
                <span style="font-size:0.75rem; color:#d4af37;">R$ ${parseFloat(snack.preco).toFixed(2)}</span>
            `;
            grid.appendChild(btn);
        });
    }

    document.getElementById('confirmSaleModal').style.display = 'flex';
}


let editandoId = null;

// 1. RENDERIZAR LISTA (BLOCOS COLORIDOS)
async function renderizarListaMensalistas() {
    const grid = document.getElementById('grid-mensalistas');
    if (!grid) return;

    try {
        const { data: clientes, error } = await _supabase
            .from('clientes_premium')
            .select('*')
            .order('data_vencimento', { ascending: true });

        if (error) throw error;
        grid.innerHTML = '';

        const hoje = new Date().setHours(0, 0, 0, 0);

        clientes.forEach(c => {
            const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
            const diff = Math.ceil((dataVenc - hoje) / 86400000);

            let cor = '#2ecc71', bg = 'rgba(46, 204, 113, 0.15)', statusLabel = c.status || 'ATIVO';

            if (statusLabel === 'INATIVO' || diff < 0) {
                cor = '#e74c3c'; bg = 'rgba(231, 76, 60, 0.2)'; statusLabel = 'INATIVO';
            } else if (diff <= 5) {
                cor = '#f1c40f'; bg = 'rgba(241, 196, 15, 0.2)'; statusLabel = 'ALERTA';
            }

            grid.innerHTML += `
            <div class="row-mensalista" style="border-left-color: ${cor}; background: ${bg};">
                <div class="col-main">
                    <strong>${c.nome.toUpperCase()}</strong>
                    <small>${c.telefone}</small>
                </div>
                <div class="col-info">
                    <span>INÍCIO</span>
                    ${new Date(c.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR')}
                </div>
                <div class="col-info status-venc" style="color: ${cor};">
                    <span>VENCIMENTO</span>
                    ${dataVenc.toLocaleDateString('pt-BR')}
                    <small class="badge-status">${statusLabel}</small>
                </div>
                <div class="col-info">
                    <span>PLANO</span>
                    R$ ${c.plano_valor.toFixed(2)}
                </div>
                
                <div class="col-actions">
                    <button onclick='prepararEdicao(${JSON.stringify(c)})' class="btn-edit">
                        <i class="fas fa-edit"></i>
                    </button>
                </div>
            </div>`;
        });
    } catch (err) { console.error(err); }
}


// 2. PREPARAR EDIÇÃO (COM INPUT DE STATUS E BOTÕES COMPACTOS)
function prepararEdicao(c) {
    editandoId = c.id;
    document.getElementById('m-nome').value = c.nome;
    document.getElementById('m-telefone').value = c.telefone;
    document.getElementById('m-data-inicio').value = c.data_inicio;
    document.getElementById('m-valor').value = c.plano_valor.toFixed(2);
    
    // Mostra o campo de Status
    const groupStatus = document.getElementById('group-status');
    if(groupStatus) {
        groupStatus.style.display = 'block';
        document.getElementById('m-status').value = c.status || 'ATIVO';
    }
    
    // Botão Salvar Verde e Pequeno
    const btnSalvar = document.querySelector('.btn-premium');
    btnSalvar.innerHTML = '<i class="fas fa-save"></i> SALVAR';
    btnSalvar.style.cssText = "background:#2ecc71; color:#fff; padding:8px 15px; font-size:0.8rem; border:none; border-radius:4px; cursor:pointer; flex:1;";

    // Botão Cancelar Pequeno
    const btnCancel = document.getElementById('btn-cancelar');
    if(btnCancel) {
        btnCancel.style.cssText = "display:inline-block; background:#444; color:#fff; padding:8px 15px; font-size:0.8rem; border:none; border-radius:4px; cursor:pointer; flex:1;";
    }
    
    // Coloca um ao lado do outro
    const containerBotoes = btnSalvar.parentElement;
    containerBotoes.style.display = "flex";
    containerBotoes.style.gap = "8px";

    document.querySelector('.formulario-direto').style.border = '1px solid #2ecc71';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}


// 3. CANCELAR / RESET
function cancelarEdicao() {
    editandoId = null;
    ['m-nome','m-telefone','m-data-inicio','m-valor'].forEach(id => document.getElementById(id).value = '');
    
    const groupStatus = document.getElementById('group-status');
    if(groupStatus) groupStatus.style.display = 'none';

    const btnSalvar = document.querySelector('.btn-premium');
    btnSalvar.innerHTML = '<i class="fas fa-check-circle"></i> CADASTRAR CLIENTE';
    btnSalvar.style.cssText = ""; // Reseta para o original do seu CSS

    const btnCancel = document.getElementById('btn-cancelar');
    if(btnCancel) btnCancel.style.display = 'none';

    document.querySelector('.formulario-direto').style.border = 'none';
}


// 1. FUNÇÃO DO BOTÃO CADASTRAR (Abre a Modal e Preenche Informações)
async function salvarMensalista() {
    const nome = document.getElementById('m-nome').value;
    const dataI = document.getElementById('m-data-inicio').value;
    const valor = parseFloat(document.getElementById('m-valor').value);
    const telefone = document.getElementById('m-telefone').value;
    const campoStatus = document.getElementById('m-status');
    const statusAtual = campoStatus ? campoStatus.value : 'ATIVO';

    if (!nome || !dataI || isNaN(valor)) return alert("Preencha os campos obrigatórios!");

    // ==========================================================
    // LÓGICA DE SALVAMENTO DIRETO (SE FOR INATIVO NA EDIÇÃO)
    // ==========================================================
    if (editandoId && statusAtual === 'INATIVO') {
        const dVencObjDirect = new Date(dataI + 'T00:00:00');
        dVencObjDirect.setMonth(dVencObjDirect.getMonth() + 1);

        const dadosInativo = {
            nome,
            telefone,
            data_inicio: dataI,
            data_vencimento: dVencObjDirect.toISOString().split('T')[0],
            plano_valor: valor,
            status: 'INATIVO'
        };

        try {
            const { error } = await _supabase.from('clientes_premium').update(dadosInativo).eq('id', editandoId);
            if (error) throw error;
            
            cancelarEdicao();
            renderizarListaMensalistas();
            // Feedback discreto em vez de alert
            if (typeof showToast === 'function') showToast(`Cliente ${nome} inativado.`);
            return;
        } catch (err) {
            return alert("Erro ao inativar: " + err.message);
        }
    }

    const dVencObj = new Date(dataI + 'T00:00:00');
    dVencObj.setMonth(dVencObj.getMonth() + 1);
    const dataVencFormatada = dVencObj.toLocaleDateString('pt-BR');

    const modal = document.getElementById('confirmSaleModal');
    if (!modal) return alert("Erro: Modal 'confirmSaleModal' não encontrada!");

    const salePreview = document.getElementById('salePreview');
    if (salePreview) {
        salePreview.innerHTML = `
            <div style="padding: 5px; color: #fff; font-family: sans-serif; line-height: 1.1;">
                <h3 style="color: #d68b00; margin: 0 0 6px 0; font-size: 11px; border-bottom: 1px solid rgba(188, 156, 95, 0.2); padding-bottom: 2px; text-transform: uppercase; letter-spacing: 0.3px;">Resumo Mensalista</h3>
                
                <div style="margin-bottom: 5px;">
                    <span style="color: #888; font-size: 8px; font-weight: bold; display: block; text-transform: uppercase; margin-bottom: -2px;">Cliente</span>
                    <div style="font-size: 11px; font-weight: bold; color: #eee;">${nome.toUpperCase()}</div>
                </div>

                <div style="margin-bottom: 5px;">
                    <span style="color: #888; font-size: 8px; font-weight: bold; display: block; text-transform: uppercase; margin-bottom: -2px;">Valor</span>
                    <div style="font-size: 13px; font-weight: bold; color: #2ecc71;">R$ ${valor.toFixed(2)}</div>
                </div>

                <div style="display: flex; gap: 12px;">
                    <div>
                        <span style="color: #888; font-size: 8px; font-weight: bold; display: block; text-transform: uppercase; margin-bottom: -2px;">Início</span>
                        <div style="font-size: 10px;">${dataI.split('-').reverse().join('/')}</div>
                    </div>
                    <div>
                        <span style="color: #888; font-size: 8px; font-weight: bold; display: block; text-transform: uppercase; margin-bottom: -2px;">Vencimento</span>
                        <div style="font-size: 10px; color: #f39c12; font-weight: bold;">${dataVencFormatada}</div>
                    </div>
                </div>
            </div>
        `;
    }

    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('visibility', 'visible', 'important');
    modal.style.setProperty('opacity', '1', 'important');

    const btnConfirmarModal = modal.querySelector('.btn-confirmar') || 
                              modal.querySelector('.btn-premium') || 
                              Array.from(modal.querySelectorAll('button')).find(b => b.innerText.includes('Confirmar'));

    if (btnConfirmarModal) {
        btnConfirmarModal.onclick = async () => {
            const metodoSelecionado = document.getElementById('paymentMethod')?.value;
            if (!metodoSelecionado) return alert("Selecione a forma de pagamento!");

            const taxa = CONFIG_TAXAS[metodoSelecionado] !== undefined ? CONFIG_TAXAS[metodoSelecionado] : 0;
            const valorDesconto = (valor * taxa).toFixed(2);
            const valorLiquido = (valor - valorDesconto).toFixed(2);

            const dados = {
                nome, 
                telefone,
                data_inicio: dataI, 
                data_vencimento: dVencObj.toISOString().split('T')[0],
                plano_valor: valor, 
                metodo_pagamento: metodoSelecionado,
                valor_desconto: valorDesconto,
                valor_liquido: valorLiquido, 
                status: statusAtual
            };

            try {
                const { error } = editandoId ? 
                    await _supabase.from('clientes_premium').update(dados).eq('id', editandoId) : 
                    await _supabase.from('clientes_premium').insert([dados]);

                if (error) throw error;

                // SUCESSO: LIMPA INTERFACE E EXIBE TOAST
                modal.style.setProperty('display', 'none', 'important');
                cancelarEdicao();
                renderizarListaMensalistas();
                
                // Mensagem personalizada sem alert
                if (typeof showToast === 'function') {
                    showToast(`Lançado: ${nome} (${metodoSelecionado})`);
                }

            } catch (err) { 
                alert("Erro ao salvar: " + err.message); 
            }
        };
    }
}


// 2. FUNÇÃO DE SALVAMENTO REAL (Deve ser chamada no "Confirmar" da Modal)
async function confirmarCadastroComPagamento() {
    // Pega o método que sua função selectMethod() salvou no input
    const metodo = document.getElementById('paymentMethod').value;
    
    if (!metodo) return alert("Selecione uma forma de pagamento na modal!");

    const nome = document.getElementById('m-nome').value;
    const dataI = document.getElementById('m-data-inicio').value;
    const valor = parseFloat(document.getElementById('m-valor').value);
    const campoStatus = document.getElementById('m-status');
    const statusAtual = campoStatus ? campoStatus.value : 'ATIVO';

    // LÓGICA DE TAXAS: 4.99% apenas se for CARTÃO
    const taxa = (metodo === 'CARTAO' || metodo === 'CREDITO' || metodo === 'DEBITO') ? 0.0499 : 0;
    const vLiq = valor * (1 - taxa);

    // Cálculo do Vencimento (+1 mês)
    const dVencObj = new Date(dataI + 'T00:00:00');
    dVencObj.setMonth(dVencObj.getMonth() + 1);

    const dados = {
        nome, 
        telefone: document.getElementById('m-telefone').value,
        data_inicio: dataI, 
        data_vencimento: dVencObj.toISOString().split('T')[0],
        plano_valor: valor, 
        valor_liquido: vLiq, 
        status: statusAtual
    };

    try {
        const { error } = editandoId ? 
            await _supabase.from('clientes_premium').update(dados).eq('id', editandoId) : 
            await _supabase.from('clientes_premium').insert([dados]);

        if (error) throw error;

        // Fecha a modal após sucesso
        document.querySelector('.modal-card').style.display = 'none';
        
        cancelarEdicao();
        renderizarListaMensalistas();
        alert("Mensalista cadastrado com sucesso!");
    } catch (err) { 
        alert("Erro ao salvar no banco: " + err.message); 
    }
}

document.addEventListener('DOMContentLoaded', renderizarListaMensalistas);

// MÁSCARA DE TELEFONE EM TEMPO REAL
document.getElementById('m-telefone').addEventListener('input', function (e) {
    let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,5})(\d{0,4})/);
    e.target.value = !x[2] ? x[1] : '(' + x[1] + ') ' + x[2] + (x[3] ? '-' + x[3] : '');
});



window.onload = init;

// Bloqueia o zoom pelo teclado (Ctrl + / Ctrl -)
window.addEventListener('keydown', function(e) {
    if (e.ctrlKey && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '_')) {
        e.preventDefault();
    }
});

// Bloqueia o zoom pela roda do mouse (Ctrl + Scroll)
window.addEventListener('wheel', function(e) {
    if (e.ctrlKey) {
        e.preventDefault();
    }
}, { passive: false });