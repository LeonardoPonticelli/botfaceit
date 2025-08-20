// Importa as bibliotecas necessárias
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');

// Cria o cliente do Discord com as permissões necessárias
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Mapeamento de cargos para o ELO/nível da Faceit.
const cargos = {
    'Nível 10': 2001,
    'Nível 9': 1751,
    'Nível 8': 1531,
    'Nível 7': 1351,
    'Nível 6': 1201,
    'Nível 5': 1051,
    'Nível 4': 901,
    'Nível 3': 751,
    'Nível 2': 501,
    'Nível 1': 100,
};

const prefix = '!';

// Função para salvar os dados do usuário
function salvarUsuario(discordId, faceitUsername) {
    let usuarios = {};
    try {
        const data = fs.readFileSync('usuarios.json');
        usuarios = JSON.parse(data);
    } catch (error) {
        console.error('Erro ao ler o arquivo de usuários, um novo será criado.');
    }

    usuarios[discordId] = faceitUsername;
    fs.writeFileSync('usuarios.json', JSON.stringify(usuarios, null, 4));
}

// Função para carregar os dados do usuário
function carregarUsuarios() {
    try {
        const data = fs.readFileSync('usuarios.json');
        return JSON.parse(data);
    } catch (error) {
        console.error('Arquivo de usuários não encontrado, iniciando com um objeto vazio.');
        return {};
    }
}

// Função para obter e atualizar o ranking de top 20
async function atualizarRanking() {
    console.log('Iniciando atualização do ranking de top 20...');
    const usuarios = carregarUsuarios();
    const guild = client.guilds.cache.first();

    if (!guild || !process.env.CANAL_RANKING) {
        console.error('Bot não está em nenhum servidor ou o canal de ranking não foi configurado.');
        return;
    }

    const canalRanking = guild.channels.cache.find(c => c.name === process.env.CANAL_RANKING);
    if (!canalRanking) {
        console.error(`Canal de ranking com o nome "${process.env.CANAL_RANKING}" não encontrado.`);
        return;
    }

    // LIMPA O CANAL ANTES DE POSTAR O NOVO RANKING
    try {
        await canalRanking.bulkDelete(100);
        console.log('Canal de ranking limpo com sucesso.');
    } catch (error) {
        console.error('Erro ao limpar o canal de ranking:', error.message);
    }


    let jogadores = [];
    for (const discordId in usuarios) {
        const faceitUsername = usuarios[discordId];
        try {
            const playerStatsResponse = await axios.get(`https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(faceitUsername)}`, {
                headers: { 'Authorization': `Bearer ${process.env.FACEIT_API_KEY}` }
            });
            const playerStats = playerStatsResponse.data;
            const cs2Stats = playerStats.games?.cs2;
            
            if (cs2Stats && cs2Stats.faceit_elo) {
                jogadores.push({
                    nickname: playerStats.nickname,
                    elo: cs2Stats.faceit_elo,
                    level: cs2Stats.skill_level,
                });
            }
        } catch (error) {
            console.error(`Erro ao buscar dados do jogador ${faceitUsername}:`, error.message);
        }
    }

    // Ordena os jogadores por ELO, do maior para o menor
    jogadores.sort((a, b) => b.elo - a.elo);
    const top20 = jogadores.slice(0, 20);

    const rankingEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('🏆 Top 20 Jogadores do Servidor')
        .setDescription('O ranking é atualizado automaticamente a cada 12 horas e a cada nova verificação.');

    if (top20.length > 0) {
        const rankingText = top20.map((jogador, index) => {
            return `**${index + 1}.** ${jogador.nickname} - **Nível ${jogador.level}** (${jogador.elo} ELO)`;
        }).join('\n');
        rankingEmbed.addFields({ name: 'Ranking Atualizado', value: rankingText });
    } else {
        rankingEmbed.setDescription('Nenhum jogador encontrado para o ranking. Use !verificar para se registrar!');
    }

    try {
        await canalRanking.send({ embeds: [rankingEmbed] });
        console.log('Ranking postado com sucesso.');
    } catch (error) {
        console.error('Erro ao postar a mensagem do ranking:', error.message);
    }
}


client.on('ready', () => {
    console.log(`Bot logado como ${client.user.tag}!`);
    console.log('Bot pronto para receber comandos.');
    // Inicia a atualização do ranking na inicialização e repete a cada 12 horas
    atualizarRanking();
    setInterval(atualizarRanking, 12 * 60 * 60 * 1000); // 12 horas
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // COMANDO DE VERIFICAÇÃO
    if (command === 'verificar') {
        const faceitUsername = args[0];
        if (!faceitUsername) {
            return message.reply('Por favor, forneça seu nome de usuário da Faceit. Ex: !verificar SEU_NOME');
        }

        const usuariosRegistrados = carregarUsuarios();
        const usuarioJaRegistrado = usuariosRegistrados[message.author.id];

        if (usuarioJaRegistrado && usuarioJaRegistrado.toLowerCase() !== faceitUsername.toLowerCase()) {
            return message.reply(`Você já está registrado com o nome de usuário da Faceit **${usuarioJaRegistrado}**. Não é possível trocar de conta.`);
        }

        try {
            // Busca o ID do jogador
            const playerResponse = await axios.get(`https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(faceitUsername)}`, {
                headers: { 'Authorization': `Bearer ${process.env.FACEIT_API_KEY}` }
            });
            const player = playerResponse.data;
            const playerId = player.player_id;

            // Busca as estatísticas do jogador
            const playerStatsResponse = await axios.get(`https://open.faceit.com/data/v4/players/${playerId}`, {
                headers: { 'Authorization': `Bearer ${process.env.FACEIT_API_KEY}` }
            });
            const playerStats = playerStatsResponse.data;
            const cs2Stats = playerStats.games?.cs2;
            
            if (!cs2Stats) {
                return message.reply(`Não foram encontradas estatísticas de CS2 para o jogador ${faceitUsername}.`);
            }
            
            // Salva o usuário no arquivo
            salvarUsuario(message.author.id, faceitUsername);
            
            const elo = cs2Stats.faceit_elo;
            const nickname = playerStats.nickname;
            
            let cargoAtribuido = 'Membro';
            const sortedCargos = Object.entries(cargos).sort(([, a], [, b]) => b - a);

            for (const [nomeCargo, eloMinimo] of sortedCargos) {
                if (elo >= eloMinimo) {
                    cargoAtribuido = nomeCargo;
                    break;
                }
            }
            
            const role = message.guild.roles.cache.find(r => r.name === cargoAtribuido);
            if (role) {
                // Checa se o membro já tem o cargo antes de atribuir para evitar spam
                const membroJaTemCargo = message.member.roles.cache.has(role.id);

                const cargosExistentes = Object.keys(cargos);
                for (const nomeCargo of cargosExistentes) {
                    const roleToRemove = message.guild.roles.cache.find(r => r.name === nomeCargo);
                    if (roleToRemove && message.member.roles.cache.has(roleToRemove.id)) {
                        await message.member.roles.remove(roleToRemove);
                    }
                }
                
                await message.member.roles.add(role);

                // NOVO CÓDIGO AQUI: TENTA MUDAR O APELIDO DO MEMBRO
                try {
                    await message.member.setNickname(nickname);
                } catch (err) {
                    console.error('Erro ao mudar o apelido:', err);
                    message.channel.send('Não foi possível mudar seu apelido. Verifique se o meu cargo está acima do seu.');
                }

                // Envia a mensagem de celebração APENAS se o cargo for novo
                if (!membroJaTemCargo) {
                    const canalMensagens = message.guild.channels.cache.find(c => c.name === process.env.CANAL_MENSAGENS);
                    if (canalMensagens) {
                        canalMensagens.send(`Parabéns, ${message.member}! Você subiu para o **${cargoAtribuido}**! 🎉`);
                    }
                }

                message.reply(`Verificação bem-sucedida para **${nickname}**! Seu apelido no servidor foi atualizado e agora você é um(a) **${cargoAtribuido}**.`);

                // NOVO: Chama a função para atualizar o ranking
                atualizarRanking();

            } else {
                message.reply(`Verificação bem-sucedida, mas o cargo **${cargoAtribuido}** não foi encontrado. Verifique se o nome do cargo no servidor está correto.`);
            }

        } catch (error) {
            console.error('Erro ao verificar o usuário:', error.response ? error.response.data : error.message);
            if (error.response && error.response.status === 404) {
                message.reply('O nome de usuário da Faceit não foi encontrado. Por favor, verifique se o nome está correto.');
            } else {
                message.reply('Ocorreu um erro ao verificar sua conta. Por favor, tente novamente mais tarde.');
            }
        }
    }

    // COMANDO !stats (mantido para utilidade)
    if (command === 'stats') {
        const faceitUsername = args[0];
        if (!faceitUsername) {
            return message.reply('Por favor, forneça um nome de usuário da Faceit.');
        }

        try {
            const playerResponse = await axios.get(`https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(faceitUsername)}`, {
                headers: { 'Authorization': `Bearer ${process.env.FACEIT_API_KEY}` }
            });
            const player = playerResponse.data;
            const playerId = player.player_id;

            const playerStatsResponse = await axios.get(`https://open.faceit.com/data/v4/players/${playerId}`, {
                headers: { 'Authorization': `Bearer ${process.env.FACEIT_API_KEY}` }
            });
            const playerStats = playerStatsResponse.data;

            const cs2Stats = playerStats.games?.cs2;
            if (!cs2Stats) {
                return message.reply(`Não foram encontradas estatísticas de CS2 para o jogador ${faceitUsername}.`);
            }
            
            const level = cs2Stats.skill_level;
            const elo = cs2Stats.faceit_elo;
            const nickname = playerStats.nickname;
            const country = playerStats.country;
            const profileUrl = `https://www.faceit.com/pt/players/${nickname}`;

            message.reply(
                `**Estatísticas de ${nickname}**\n` +
                `**País:** ${country.toUpperCase()}\n` +
                `**Nível:** ${level}\n` +
                `**ELO:** ${elo}\n` +
                `**Perfil:** ${profileUrl}`
            );

        } catch (error) {
            console.error('Erro ao buscar as estatísticas:', error.response ? error.response.data : error.message);
            if (error.response && error.response.status === 404) {
                message.reply('O nome de usuário da Faceit não foi encontrado. Por favor, verifique se o nome está correto.');
            } else {
                message.reply('Ocorreu um erro ao buscar as estatísticas. Por favor, tente novamente mais tarde.');
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);