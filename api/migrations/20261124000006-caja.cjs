'use strict';

/** Fase 5: caja y cobranza — cajas con arqueo, pagos (cada uno es un recibo), a qué facturas se aplican y venta de productos. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, BOOLEAN, DATE, DECIMAL, JSONB, UUID } = Sequelize;
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

      // Turno de un cajero: abre con un fondo, cobra, y cierra contando el efectivo (arqueo).
      await queryInterface.createTable(
        'cajas',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          cajero_id: { type: INTEGER, allowNull: false, ...ref('usuarios') },
          abierta_el: { type: DATE, allowNull: false, defaultValue: now },
          cerrada_el: { type: DATE, allowNull: true },
          fondo_inicial: { type: DECIMAL(14, 2), allowNull: false },
          // Se guardan al cerrar: lo que tenía que haber en efectivo y lo que se contó.
          total_esperado: { type: DECIMAL(14, 2), allowNull: true },
          total_contado: { type: DECIMAL(14, 2), allowNull: true },
          nota: { type: STRING(200), allowNull: true },
          ...timestamps,
        },
        { transaction },
      );
      await check('cajas', 'cajas_fondo_valido', 'fondo_inicial >= 0');
      await check('cajas', 'cajas_arqueo_al_cerrar', '(cerrada_el IS NULL) = (total_contado IS NULL) AND (cerrada_el IS NULL) = (total_esperado IS NULL)');
      // Una sola caja abierta por cajero.
      await sql(`CREATE UNIQUE INDEX cajas_una_abierta ON cajas (cajero_id) WHERE cerrada_el IS NULL`);
      await queryInterface.addIndex('cajas', ['cooperativa_id', 'abierta_el'], { name: 'cajas_fecha_idx', transaction });

      // Lo que se vende en el mostrador además de cobrar facturas: gas envasado y otros conceptos.
      await queryInterface.createTable(
        'productos',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          nombre: { type: STRING(80), allowNull: false },
          precio: { type: DECIMAL(14, 2), allowNull: false },
          stock: { type: INTEGER, allowNull: true }, // null = no lleva control de stock
          activo: { type: BOOLEAN, allowNull: false, defaultValue: true },
          ...timestamps,
        },
        { transaction },
      );
      await check('productos', 'productos_precio_valido', 'precio >= 0');
      await check('productos', 'productos_stock_valido', 'stock IS NULL OR stock >= 0');
      await queryInterface.addIndex('productos', ['cooperativa_id', 'nombre'], { unique: true, name: 'productos_nombre_unico', transaction });

      // Un cobro. Lleva su propio número de recibo y no se edita ni se borra: si estuvo mal, se anula.
      await queryInterface.createTable(
        'pagos',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          caja_id: { type: INTEGER, allowNull: true, ...ref('cajas') }, // null en los pagos online
          cajero_id: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          socio_id: { type: INTEGER, allowNull: true, ...ref('socios') }, // null = venta de mostrador a un no socio
          letra: { type: STRING(1), allowNull: false },
          punto_venta: { type: INTEGER, allowNull: false },
          numero: { type: INTEGER, allowNull: false },
          medio: { type: STRING(14), allowNull: false },
          origen: { type: STRING(10), allowNull: false, defaultValue: 'mostrador' },
          estado: { type: STRING(10), allowNull: false, defaultValue: 'acreditado' },
          importe: { type: DECIMAL(14, 2), allowNull: false },
          recibido: { type: DECIMAL(14, 2), allowNull: true },
          vuelto: { type: DECIMAL(14, 2), allowNull: true },
          cobrado_el: { type: DATE, allowNull: false, defaultValue: now },
          ref_externa: { type: STRING(60), allowNull: true },
          // La manda la pantalla: repetir el pedido (doble Enter, reintento por mala señal) no cobra dos veces.
          clave: { type: UUID, allowNull: true },
          snapshot_json: { type: JSONB, allowNull: false },
          anulado_el: { type: DATE, allowNull: true },
          anulado_por: { type: INTEGER, allowNull: true, ...ref('usuarios', 'SET NULL') },
          motivo_anulacion: { type: STRING(200), allowNull: true },
          ...timestamps,
        },
        { transaction },
      );
      await check('pagos', 'pagos_medio_valido', "medio IN ('efectivo','transferencia','debito','credito','qr')");
      await check('pagos', 'pagos_origen_valido', "origen IN ('mostrador','online')");
      await check('pagos', 'pagos_estado_valido', "estado IN ('acreditado','anulado')");
      await check('pagos', 'pagos_letra_valida', "letra IN ('A','B')");
      await check('pagos', 'pagos_importe_valido', 'importe > 0');
      await check('pagos', 'pagos_vuelto_valido', '(recibido IS NULL AND vuelto IS NULL) OR (recibido >= importe AND vuelto = recibido - importe)');
      await check('pagos', 'pagos_anulado_con_motivo', "(estado = 'anulado') = (anulado_el IS NOT NULL) AND (estado = 'anulado') = (motivo_anulacion IS NOT NULL)");
      // Recibos numerados sin repetir, igual que las facturas.
      await queryInterface.addIndex('pagos', ['cooperativa_id', 'letra', 'punto_venta', 'numero'], { unique: true, name: 'pagos_numero_unico', transaction });
      await sql(`CREATE UNIQUE INDEX pagos_clave_unica ON pagos (cooperativa_id, clave) WHERE clave IS NOT NULL`);
      await queryInterface.addIndex('pagos', ['caja_id'], { name: 'pagos_caja_idx', transaction });
      await queryInterface.addIndex('pagos', ['socio_id', 'cobrado_el'], { name: 'pagos_socio_idx', transaction });
      await queryInterface.addIndex('pagos', ['cooperativa_id', 'cobrado_el'], { name: 'pagos_fecha_idx', transaction });

      // A qué comprobantes se aplicó cada pago. Saldo de un comprobante = total − pagos acreditados aplicados.
      await queryInterface.createTable(
        'pago_aplicaciones',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          pago_id: { type: INTEGER, allowNull: false, ...ref('pagos', 'CASCADE') },
          comprobante_id: { type: INTEGER, allowNull: false, ...ref('comprobantes') },
          importe: { type: DECIMAL(14, 2), allowNull: false },
          // Lo que quedó debiendo de esa factura después de este pago (para imprimirlo en el recibo).
          saldo_despues: { type: DECIMAL(14, 2), allowNull: false },
        },
        { transaction },
      );
      await check('pago_aplicaciones', 'aplicaciones_importe_valido', 'importe > 0 AND saldo_despues >= 0');
      await queryInterface.addIndex('pago_aplicaciones', ['pago_id', 'comprobante_id'], { unique: true, name: 'aplicaciones_unica', transaction });
      // También la usa Postgres al borrar pre-facturas, para ver que nadie las referencia.
      await queryInterface.addIndex('pago_aplicaciones', ['comprobante_id'], { name: 'aplicaciones_comprobante_idx', transaction });

      // Productos vendidos en un cobro.
      await queryInterface.createTable(
        'pago_items',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: cooperativaId,
          pago_id: { type: INTEGER, allowNull: false, ...ref('pagos', 'CASCADE') },
          producto_id: { type: INTEGER, allowNull: true, ...ref('productos', 'SET NULL') },
          descripcion: { type: STRING(120), allowNull: false },
          cantidad: { type: INTEGER, allowNull: false },
          unitario: { type: DECIMAL(14, 2), allowNull: false },
          importe: { type: DECIMAL(14, 2), allowNull: false },
        },
        { transaction },
      );
      await check('pago_items', 'items_validos', 'cantidad > 0 AND importe = cantidad * unitario');
      await queryInterface.addIndex('pago_items', ['pago_id'], { name: 'items_pago_idx', transaction });
      await queryInterface.addIndex('pago_items', ['producto_id'], { name: 'items_producto_idx', transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const table of ['pago_items', 'pago_aplicaciones', 'pagos', 'productos', 'cajas']) {
        await queryInterface.dropTable(table, { transaction });
      }
    });
  },
};
