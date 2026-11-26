'use strict';

/**
 * Fase 6: portal del socio — pago online (intentos y la pasarela simulada), reclamos con su historial
 * y foto, cortes programados, adhesión a la factura digital y cuenta del socio sin email.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, BOOLEAN, DATE, DECIMAL, JSONB, UUID, TEXT, BLOB } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');
    const ref = (model, onDelete = 'RESTRICT') => ({ references: { model, key: 'id' }, onDelete, onUpdate: 'CASCADE' });
    const cooperativaId = { type: INTEGER, allowNull: false, ...ref('cooperativas') };
    const timestamps = {
      creado_el: { type: DATE, allowNull: false, defaultValue: now },
      actualizado_el: { type: DATE, allowNull: false, defaultValue: now },
    };

    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (text) => queryInterface.sequelize.query(text, { transaction });
      const check = (table, name, expr) => sql(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr})`);

      // El socio entra con su DNI o su número de socio: su usuario no necesita email.
      await queryInterface.changeColumn('usuarios', 'email', { type: STRING(200), allowNull: true }, { transaction });

      // Adhesión a la factura digital (deja de recibirla en papel).
      await queryInterface.addColumn('socios', 'factura_digital', { type: BOOLEAN, allowNull: false, defaultValue: false }, { transaction });

      // Un pago online empieza como intento: el socio elige qué facturas paga y va a la pasarela.
      // El id es el «TransaccionComercioId» que viaja al proveedor: reintentar nunca cobra dos veces.
      await queryInterface.createTable(
        'intentos_pago',
        {
          id: { type: UUID, primaryKey: true },
          cooperativa_id: cooperativaId,
          socio_id: { type: INTEGER, allowNull: false, ...ref('socios') },
          origen: { type: STRING(10), allowNull: false }, // portal | qr
          proveedor: { type: STRING(20), allowNull: false },
          estado: { type: STRING(10), allowNull: false, defaultValue: 'pendiente' },
          total: { type: DECIMAL(14, 2), allowNull: false },
          // Un ítem por factura, como se mandan al proveedor: { comprobanteId, descripcion, importe }.
          items_json: { type: JSONB, allowNull: false },
          medio: { type: STRING(14), allowNull: true },
          ref_externa: { type: STRING(60), allowNull: true },
          motivo: { type: STRING(200), allowNull: true },
          pago_id: { type: INTEGER, allowNull: true, ...ref('pagos') },
          vence_el: { type: DATE, allowNull: false },
          resuelto_el: { type: DATE, allowNull: true },
          creado_por: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          ...timestamps,
        },
        { transaction },
      );
      await check('intentos_pago', 'intentos_estado_valido', "estado IN ('pendiente','aprobado','rechazado','cancelado','vencido')");
      await check('intentos_pago', 'intentos_origen_valido', "origen IN ('portal','qr')");
      await check('intentos_pago', 'intentos_total_valido', 'total > 0');
      await check('intentos_pago', 'intentos_aprobado_con_pago', "(estado = 'aprobado') = (pago_id IS NOT NULL)");
      await queryInterface.addIndex('intentos_pago', ['socio_id', 'creado_el'], { name: 'intentos_socio_idx', transaction });
      await sql(`CREATE UNIQUE INDEX intentos_pago_unico ON intentos_pago (pago_id) WHERE pago_id IS NOT NULL`);

      // Lo que la pasarela de prueba «sabe» de cada operación: hace de banco en la demo.
      await queryInterface.createTable(
        'pasarela_simulada',
        {
          intento_id: { type: UUID, primaryKey: true, ...ref('intentos_pago', 'CASCADE') },
          cooperativa_id: cooperativaId,
          estado: { type: STRING(10), allowNull: false },
          medio: { type: STRING(14), allowNull: true },
          referencia: { type: STRING(40), allowNull: true },
          importe: { type: DECIMAL(14, 2), allowNull: false },
          motivo: { type: STRING(200), allowNull: true },
          ...timestamps,
        },
        { transaction },
      );
      await check('pasarela_simulada', 'pasarela_estado_valido', "estado IN ('pendiente','aprobado','rechazado','cancelado')");

      // Un pago online sabe de qué intento salió (y un intento acreditado, de qué pago).
      await queryInterface.addColumn('pagos', 'intento_id', { type: UUID, allowNull: true, ...ref('intentos_pago') }, { transaction });
      await sql(`CREATE UNIQUE INDEX pagos_intento_unico ON pagos (intento_id) WHERE intento_id IS NOT NULL`);
      // Si una factura se pagó por otro lado mientras el socio pagaba online, lo que sobra queda a su favor.
      await queryInterface.addColumn('pagos', 'a_favor', { type: DECIMAL(14, 2), allowNull: false, defaultValue: 0 }, { transaction });
      await check('pagos', 'pagos_a_favor_valido', 'a_favor >= 0 AND a_favor <= importe');

      // Reclamos: del socio desde el portal, o tomados por teléfono o en la oficina.
      await queryInterface.createTable(
        'reclamos',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          numero: { type: INTEGER, allowNull: false },
          socio_id: { type: INTEGER, allowNull: true, ...ref('socios') },
          conexion_id: { type: INTEGER, allowNull: true, ...ref('conexiones') },
          servicio: { type: STRING(16), allowNull: false },
          tipo: { type: STRING(24), allowNull: false },
          descripcion: { type: STRING(500), allowNull: true },
          prioridad: { type: STRING(8), allowNull: false },
          estado: { type: STRING(10), allowNull: false, defaultValue: 'nuevo' },
          origen: { type: STRING(10), allowNull: false },
          cuadrilla: { type: STRING(60), allowNull: true },
          // Dónde: el domicilio de la conexión o lo que diga quien reclama, y el punto del teléfono si lo mandó.
          direccion: { type: STRING(200), allowNull: true },
          lat: { type: DECIMAL(9, 6), allowNull: true },
          lng: { type: DECIMAL(9, 6), allowNull: true },
          contacto: { type: STRING(40), allowNull: true },
          tiene_foto: { type: BOOLEAN, allowNull: false, defaultValue: false },
          asignado_el: { type: DATE, allowNull: true },
          iniciado_el: { type: DATE, allowNull: true },
          resuelto_el: { type: DATE, allowNull: true },
          resolucion: { type: STRING(500), allowNull: true },
          creado_por: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          ...timestamps,
        },
        { transaction },
      );
      await check('reclamos', 'reclamos_estado_valido', "estado IN ('nuevo','asignado','en_curso','resuelto')");
      await check('reclamos', 'reclamos_prioridad_valida', "prioridad IN ('baja','media','alta','urgente')");
      await check('reclamos', 'reclamos_origen_valido', "origen IN ('portal','telefono','oficina')");
      await check('reclamos', 'reclamos_servicio_valido', "servicio IN ('energia','agua','internet','tv','administrativo')");
      await check('reclamos', 'reclamos_resuelto_con_texto', "(estado = 'resuelto') = (resuelto_el IS NOT NULL) AND (estado <> 'resuelto' OR resolucion IS NOT NULL)");
      await queryInterface.addIndex('reclamos', ['cooperativa_id', 'numero'], { unique: true, name: 'reclamos_numero_unico', transaction });
      await queryInterface.addIndex('reclamos', ['cooperativa_id', 'estado', 'creado_el'], { name: 'reclamos_estado_idx', transaction });
      await queryInterface.addIndex('reclamos', ['socio_id'], { name: 'reclamos_socio_idx', transaction });
      await queryInterface.addIndex('reclamos', ['conexion_id'], { name: 'reclamos_conexion_idx', transaction });

      await queryInterface.createTable(
        'reclamo_fotos',
        {
          reclamo_id: { type: INTEGER, primaryKey: true, ...ref('reclamos', 'CASCADE') },
          cooperativa_id: cooperativaId,
          mime: { type: STRING(40), allowNull: false },
          contenido: { type: BLOB, allowNull: false },
          ...timestamps,
        },
        { transaction },
      );

      // Historial: cada cambio de estado y cada nota. Lo que es visible para el socio lo ve en el portal.
      await queryInterface.createTable(
        'reclamo_eventos',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          reclamo_id: { type: INTEGER, allowNull: false, ...ref('reclamos', 'CASCADE') },
          estado: { type: STRING(10), allowNull: true }, // null = solo una nota
          nota: { type: TEXT, allowNull: true },
          visible_socio: { type: BOOLEAN, allowNull: false, defaultValue: true },
          usuario_id: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          creado_el: { type: DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );
      await check('reclamo_eventos', 'eventos_con_algo', 'estado IS NOT NULL OR nota IS NOT NULL');
      await queryInterface.addIndex('reclamo_eventos', ['reclamo_id', 'creado_el'], { name: 'eventos_reclamo_idx', transaction });

      // Cortes programados: por zona (o en toda la localidad), con fecha y motivo. Avisan al socio.
      await queryInterface.createTable(
        'cortes_programados',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          zona_id: { type: INTEGER, allowNull: true, ...ref('zonas') }, // null = toda la localidad
          servicio: { type: STRING(12), allowNull: false },
          desde: { type: DATE, allowNull: false },
          hasta: { type: DATE, allowNull: false },
          motivo: { type: STRING(200), allowNull: false },
          avisados: { type: INTEGER, allowNull: false, defaultValue: 0 },
          cancelado_el: { type: DATE, allowNull: true },
          creado_por: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          ...timestamps,
        },
        { transaction },
      );
      await check('cortes_programados', 'cortes_servicio_valido', "servicio IN ('energia','agua','internet','tv')");
      await check('cortes_programados', 'cortes_horario_valido', 'hasta > desde');
      await queryInterface.addIndex('cortes_programados', ['cooperativa_id', 'hasta'], { name: 'cortes_fecha_idx', transaction });
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const table of ['cortes_programados', 'reclamo_eventos', 'reclamo_fotos', 'reclamos']) {
        await queryInterface.dropTable(table, { transaction });
      }
      await queryInterface.removeColumn('pagos', 'a_favor', { transaction });
      await queryInterface.removeColumn('pagos', 'intento_id', { transaction });
      await queryInterface.dropTable('pasarela_simulada', { transaction });
      await queryInterface.dropTable('intentos_pago', { transaction });
      await queryInterface.removeColumn('socios', 'factura_digital', { transaction });
      await queryInterface.changeColumn('usuarios', 'email', { type: Sequelize.STRING(200), allowNull: false }, { transaction });
    });
  },
};
