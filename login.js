// --- CONFIGURAÇÃO SUPABASE ---
const SUPABASE_URL = 'https://ehjtfhltnefsjketvumy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoanRmaGx0bmVmc2prZXR2dW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4OTQ3NDAsImV4cCI6MjA4NTQ3MDc0MH0.B_48kBjvRYk9sdZKlrpPlDROiPOsMnGpRva-jmgukVc';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- CONTROLE DE INTERFACE ---
function toggleAuth() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const title = document.getElementById('portal-title');
    const status = document.getElementById('portal-status');

    if (loginForm.style.display === 'none') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        title.innerHTML = 'BARBEARIA <span>GOUVÊA</span>';
        status.innerText = 'LOGIN';
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        title.innerHTML = 'REGISTRO <span>SISTEMA</span>';
        status.innerText = 'CADASTRO';
    }
}

// --- LÓGICA DE REGISTRO (SALVA NA NUVEM) ---
document.getElementById('registerForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const newUser = document.getElementById('reg-username').value;
    const newPass = document.getElementById('reg-password').value;

    if(newUser.length < 3 || newPass.length < 4) {
        showModalAlert("Dados insuficientes para criptografia de Barbearia Gouvêa.");
        return;
    }

    // --- NOVA LÓGICA DO PIN ---
    // Gera um número aleatório de 4 dígitos (entre 1000 e 9999)
    const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();

    // Salva o novo usuário na tabela auth_config do Supabase (incluindo o recovery_pin)
    const { error } = await _supabase
        .from('auth_config')
        .insert([{ 
            username: newUser, 
            password: newPass,
            recovery_pin: generatedPin // Certifique-se que a coluna existe no Supabase
        }]);

    if (error) {
        showModalAlert("Erro ao registrar: Talvez este usuário já exista.");
    } else {
        // Alerta o usuário sobre o PIN gerado antes de trocar de tela
        showModalAlert("Proprietário registrado na nuvem com sucesso!\n\n" +
              "SUA CHAVE DE RECUPERAÇÃO (PIN): " + generatedPin + "\n" +
              "Guarde este número! Você precisará dele se esquecer a senha.");
        
        toggleAuth();
    }
});

// --- LÓGICA DE LOGIN (CONSULTA A NUVEM) ---
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const userIn = document.getElementById('username').value;
    const passIn = document.getElementById('password').value;
    const remember = document.getElementById('remember').checked;

    // Busca no Supabase
    const { data, error } = await _supabase
        .from('auth_config')
        .select('*')
        .eq('username', userIn)
        .eq('password', passIn)
        .single();

    if (data) {
        // Sucesso! Define se a sessão é permanente ou temporária
        if (remember) {
            localStorage.setItem('barber_logged', 'true');
        } else {
            sessionStorage.setItem('barber_logged', 'true');
        }
        
        document.body.style.opacity = '0';
        setTimeout(() => window.location.href = 'index.html', 500);
    } else {
        // Erro: Feedback visual
        const portal = document.querySelector('.login-portal');
        portal.style.animation = 'shake 0.5s';
        setTimeout(() => portal.style.animation = '', 500);
        showModalAlert('ACESSO NEGADO: Chave de segurança incorreta.');
        document.getElementById('password').value = '';
    }
});

// --- VERIFICAÇÃO DE SEGURANÇA AO ABRIR ---
window.onload = async () => {
    // 1. Se já houver flag de login, vai direto
    if (localStorage.getItem('barber_logged') === 'true' || sessionStorage.getItem('barber_logged') === 'true') {
        window.location.href = 'index.html';
        return;
    }

    // 2. Verifica se existe algum usuário no banco. Se não houver, abre Registro.
    const { data } = await _supabase.from('auth_config').select('id').limit(1);
    if (!data || data.length === 0) {
        toggleAuth();
    }
};

// CSS de tremor
const styleSheet = document.createElement("style");
styleSheet.innerText = `
@keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-10px); }
    75% { transform: translateX(10px); }
}`;
document.head.appendChild(styleSheet);


// Abrir Modal
function forgotPassword() {
    document.getElementById('forgot-modal').style.display = 'flex';
}

// Fechar Modal
function closeForgotModal() {
    document.getElementById('forgot-modal').style.display = 'none';
}

// Lógica de Redefinição via Modal
// Lógica de Redefinição via Modal (VALIDAÇÃO PARA CAMPO NUMÉRICO)
document.getElementById('forgotForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const userIn = document.getElementById('reset-username').value.trim();
    const pinIn = document.getElementById('reset-pin').value.trim(); 
    const newPass = document.getElementById('reset-new-password').value.trim();

    if (!userIn || !pinIn || !newPass) {
        alert("Preencha todos os campos do terminal.");
        return;
    }

    try {
        // 1. Busca os dados do usuário
        const { data, error } = await _supabase
            .from('auth_config')
            .select('username, recovery_pin')
            .eq('username', userIn)
            .maybeSingle();

        if (error || !data) {
            showModalAlert("ERRO: Usuário não identificado.");
            return;
        }

        // --- VALIDAÇÃO NUMÉRICA PRECISA ---
        // Convertemos os dois para Inteiros para garantir a precisão
        const pinBanco = parseInt(data.recovery_pin);
        const pinDigitado = parseInt(pinIn);

        // Se o que o usuário digitou não for um número válido ou for diferente do banco
        if (isNaN(pinDigitado) || pinDigitado !== pinBanco) {
            showModalAlert("ACESSO NEGADO: O PIN de recuperação está incorreto para este usuário.");
            
            // Feedback de tremor
            const modalContent = document.querySelector('.modal-content');
            modalContent.style.animation = 'shake 0.5s';
            setTimeout(() => modalContent.style.animation = '', 500);
            
            return; // TRAVA AQUI. Não deixa atualizar.
        }
        // -------------------------------------

        // 2. ATUALIZAÇÃO AUTORIZADA
        const { error: updateError } = await _supabase
            .from('auth_config')
            .update({ password: newPass })
            .eq('username', userIn);

        if (updateError) {
            showModalAlert("Erro ao gravar nova chave na nuvem.");
        } else {
            showModalAlert("IDENTIDADE VALIDADA!\nSua senha foi alterada com sucesso.");
            closeForgotModal();
            // Limpa o formulário
            e.target.reset();
        }

    } catch (err) {
        showModalAlert("Erro de comunicação com o banco de dados.");
    }
});


function showModalAlert(message, type = 'info') {
    const alertBox = document.getElementById('custom-alert');
    const alertMsg = document.getElementById('alert-message');
    const alertIcon = document.getElementById('alert-icon');
    
    alertMsg.innerText = message;
    
    // Muda o ícone dependendo do tipo
    if (type === 'error') {
        alertIcon.className = "fas fa-exclamation-triangle";
        alertIcon.style.color = "#ff4d4d";
    } else {
        alertIcon.className = "fas fa-crown";
        alertIcon.style.color = "var(--accent)";
    }
    
    alertBox.style.display = 'flex';
}

function closeAlert() {
    document.getElementById('custom-alert').style.display = 'none';
}

// Fechar modal ao clicar fora dele
window.onclick = function(event) {
    const modal = document.getElementById('forgot-modal');
    if (event.target == modal) {
        closeForgotModal();
    }
}