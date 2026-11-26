'use strict';

/** Fase 4: facturación — comprobantes y sus renglones, numeración, trabajos en segundo plano y avisos al socio. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, SMALLINT, STRING, BOOLEAN, DATE, DATEONLY, DECIMAL, JSONB, TEXT } = Sequelize;
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

      // Factura, nota de crédito, nota de débito o recibo. Nace como borrador (pre-factura, sin número);
      // al emitirse recibe su número y no se edita más.
      await queryInterface.createTable(
        'comprobantes',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          tipo: { type: STRING(14), allowNull: false },
          letra: { type: STRING(1), allowNull: false },
          punto_venta: { type: INTEGER, allowNull: false },
          numero: { type: INTEGER, allowNull: true }, // null mientras es borrador
          socio_id: { type: INTEGER, allowNull: false, ...ref('socios') },
          conexion_id: { type: INTEGER, allowNull: true, ...ref('conexiones') },
          servicio_conexion_id: { type: INTEGER, allowNull: true, ...ref('servicios_conexion') },
          servicio: { type: STRING(12), allowNull: false },
          anio: { type: SMALLINT, allowNull: false },
          mes: { type: SMALLINT, allowNull: false },
          periodo_id: { type: INTEGER, allowNull: true, ...ref('periodos') }, // solo energía y agua
          // Posición en el recorrido: las facturas se numeran en el orden en que se reparten.
          orden: { type: INTEGER, allowNull: false, defaultValue: 0 },
          estado: { type: STRING(10), allowNull: false, defaultValue: 'borrador' },
          emitido_el: { type: DATEONLY, allowNull: true },
          vence_el: { type: DATEONLY, allowNull: true },
          total: { type: DECIMAL(14, 2), allowNull: false },
          saldo: { type: DECIMAL(14, 2), allowNull: false },
          // Subtotal + gravámenes, sin adicionales ni mora: es lo que se compara mes contra mes.
          total_servicio: { type: DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          consumo: { type: DECIMAL(14, 4), allowNull: true },
          // Consumo cobrado de más por una estimación: se descuenta en la factura siguiente.
          a_favor: { type: DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
          estimada: { type: BOOLEAN, allowNull: false, defaultValue: false },
          rara: { type: STRING(16), allowNull: true },
          total_anterior: { type: DECIMAL(14, 2), allowNull: true },
          variacion: { type: DECIMAL(9, 1), allowNull: true },
          revisada_el: { type: DATE, allowNull: true },
          revisada_por: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          error: { type: STRING(300), allowNull: true }, // no se pudo calcular: qué falta
          origen_id: { type: INTEGER, allowNull: true, ...ref('comprobantes') }, // la factura que anula una nota de crédito
          motivo: { type: STRING(200), allowNull: true },
          cae: { type: STRING(20), allowNull: true },
          cae_vence: { type: DATEONLY, allowNull: true },
          snapshot_json: { type: JSONB, allowNull: false },
          creado_por: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          ...timestamps,
        },
        { transaction },
      );
      await check('comprobantes', 'comprobantes_tipo_valido', "tipo IN ('factura','nota_credito','nota_debito','recibo')");
      await check('comprobantes', 'comprobantes_letra_valida', "letra IN ('A','B')");
      await check('comprobantes', 'comprobantes_estado_valido', "estado IN ('borrador','emitido','pagado','anulado')");
      await check('comprobantes', 'comprobantes_mes_valido', 'mes BETWEEN 1 AND 12');
      // Un borrador no tiene número ni fecha; un comprobante emitido tiene las dos cosas.
      await check('comprobantes', 'comprobantes_numero_si_emitido', "(estado = 'borrador') = (numero IS NULL) AND (estado = 'borrador') = (emitido_el IS NULL)");
      await check('comprobantes', 'comprobantes_saldo_valido', 'saldo >= 0 AND saldo <= GREATEST(total, 0)');
      await check('comprobantes', 'comprobantes_rara_valida', "rara IS NULL OR rara IN ('variacion','importe_cero','sin_lectura')");
      // Numeración correlativa por tipo, letra y punto de venta: el mismo número no puede salir dos veces.
      await queryInterface.addIndex('comprobantes', ['cooperativa_id', 'tipo', 'letra', 'punto_venta', 'numero'], { unique: true, name: 'comprobantes_numero_unico', transaction });
      // Una sola factura viva por servicio y mes: no se puede facturar dos veces lo mismo.
      await sql(
        `CREATE UNIQUE INDEX comprobantes_factura_unica ON comprobantes (servicio_conexion_id, anio, mes)
         WHERE tipo = 'factura' AND estado <> 'anulado' AND servicio_conexion_id IS NOT NULL`,
      );
      await queryInterface.addIndex('comprobantes', ['cooperativa_id', 'anio', 'mes', 'estado'], { name: 'comprobantes_mes_idx', transaction });
      await queryInterface.addIndex('comprobantes', ['socio_id', 'estado'], { name: 'comprobantes_socio_idx', transaction });
      await sql(`CREATE INDEX comprobantes_deuda_idx ON comprobantes (cooperativa_id, vence_el) WHERE estado = 'emitido' AND saldo > 0`);
      // Al borrar pre-facturas, Postgres busca quién las referencia: sin este índice recorre la tabla entera por cada una.
      await sql(`CREATE INDEX comprobantes_origen_idx ON comprobantes (origen_id) WHERE origen_id IS NOT NULL`);

      await queryInterface.createTable(
        'comprobante_renglones',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          comprobante_id: { type: INTEGER, allowNull: false, ...ref('comprobantes', 'CASCADE') },
          orden: { type: SMALLINT, allowNull: false },
          grupo: { type: STRING(10), allowNull: false },
          codigo: { type: STRING(24), allowNull: false },
          servicio: { type: STRING(12), allowNull: false },
          descripcion: { type: STRING(200), allowNull: false },
          // Los valores con los que se calculó: quedan aunque después cambie la tarifa.
          cantidad: { type: DECIMAL(16, 4), allowNull: true },
          unitario: { type: DECIMAL(18, 6), allowNull: true },
          porcentaje: { type: DECIMAL(12, 6), allowNull: true },
          base: { type: DECIMAL(14, 2), allowNull: true },
          importe: { type: DECIMAL(14, 2), allowNull: false },
          subsidiado: { type: BOOLEAN, allowNull: false, defaultValue: false },
          nota: { type: STRING(200), allowNull: true },
        },
        { transaction },
      );
      await check('comprobante_renglones', 'renglones_grupo_valido', "grupo IN ('basico','cargo','gravamen','adicional','recargo')");
      await queryInterface.addIndex('comprobante_renglones', ['comprobante_id', 'orden'], { name: 'renglones_comprobante_idx', transaction });

      // Último número usado de cada tipo de comprobante. Se bloquea la fila al numerar: sin huecos ni repetidos.
      await queryInterface.createTable(
        'numeradores',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          tipo: { type: STRING(14), allowNull: false },
          letra: { type: STRING(1), allowNull: false },
          punto_venta: { type: INTEGER, allowNull: false },
          ultimo: { type: INTEGER, allowNull: false, defaultValue: 0 },
          ...timestamps,
        },
        { transaction },
      );
      await queryInterface.addIndex('numeradores', ['cooperativa_id', 'tipo', 'letra', 'punto_venta'], { unique: true, name: 'numeradores_unico', transaction });

      // Pre-facturar y emitir corren en segundo plano: acá queda su avance para la barra de progreso.
      await queryInterface.createTable(
        'procesos_facturacion',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          tipo: { type: STRING(12), allowNull: false },
          anio: { type: SMALLINT, allowNull: false },
          mes: { type: SMALLINT, allowNull: false },
          estado: { type: STRING(10), allowNull: false, defaultValue: 'en_curso' },
          total: { type: INTEGER, allowNull: false, defaultValue: 0 },
          hechas: { type: INTEGER, allowNull: false, defaultValue: 0 },
          error: { type: STRING(300), allowNull: true },
          usuario_id: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          terminado_el: { type: DATE, allowNull: true },
          ...timestamps,
        },
        { transaction },
      );
      await check('procesos_facturacion', 'procesos_tipo_valido', "tipo IN ('prefactura','emision')");
      await check('procesos_facturacion', 'procesos_estado_valido', "estado IN ('en_curso','terminado','fallido')");
      // Un solo trabajo a la vez por cooperativa.
      await sql(`CREATE UNIQUE INDEX procesos_uno_a_la_vez ON procesos_facturacion (cooperativa_id) WHERE estado = 'en_curso'`);
      await queryInterface.addIndex('procesos_facturacion', ['cooperativa_id', 'anio', 'mes'], { name: 'procesos_mes_idx', transaction });

      // Avisos al socio. En la demo no se envían: quedan acá (proveedor de notificaciones simulado).
      await queryInterface.createTable(
        'notificaciones',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          socio_id: { type: INTEGER, allowNull: false, ...ref('socios') },
          comprobante_id: { type: INTEGER, allowNull: true, ...ref('comprobantes', 'CASCADE') },
          canal: { type: STRING(10), allowNull: false },
          destino: { type: STRING(200), allowNull: false },
          asunto: { type: STRING(160), allowNull: false },
          cuerpo: { type: TEXT, allowNull: false },
          estado: { type: STRING(10), allowNull: false, defaultValue: 'simulada' },
          creado_el: { type: DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );
      await queryInterface.addIndex('notificaciones', ['cooperativa_id', 'socio_id', 'creado_el'], { name: 'notificaciones_socio_idx', transaction });
      await queryInterface.addIndex('notificaciones', ['comprobante_id'], { name: 'notificaciones_comprobante_idx', transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const table of ['notificaciones', 'procesos_facturacion', 'numeradores', 'comprobante_renglones', 'comprobantes']) {
        await queryInterface.dropTable(table, { transaction });
      }
    });
  },
};
