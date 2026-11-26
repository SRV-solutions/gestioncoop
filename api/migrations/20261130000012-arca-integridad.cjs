'use strict';

/**
 * Factura electrónica real, integridad de los datos y alertas.
 * - config_fiscal: con qué se conecta cada cooperativa a ARCA (ambiente, CUIT, certificado y su clave
 *   cifrada, cómo se informa cada concepto de la tarifa) y el permiso de acceso que entregó ARCA, para no
 *   pedirlo de nuevo mientras siga vigente.
 * - comprobantes.cae_ambiente: quién autorizó cada comprobante (simulado, homologación o producción).
 * - huella en comprobantes, pagos y auditoría: cada fila emitida queda encadenada con la anterior de su
 *   talonario (o de su registro) con una firma HMAC. Si alguien cambia, borra o agrega una fila por fuera
 *   de la app, la cadena se corta ahí.
 * - verificaciones_integridad: cada vez que se revisó la cadena, qué se encontró.
 * - alertas: avisos al personal y a SRV dentro de la app, con el mail que se mandó.
 * - intentos_acceso_socio: fallos seguidos en el ingreso del socio, por código de socio.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, DATE, DATEONLY, TEXT, JSONB, BOOLEAN } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');
    const coop = { type: INTEGER, allowNull: false, references: { model: 'cooperativas', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' };
    const usuario = (allowNull) => ({ type: INTEGER, allowNull, references: { model: 'usuarios', key: 'id' }, onDelete: allowNull ? 'SET NULL' : 'CASCADE', onUpdate: 'CASCADE' });

    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (text) => queryInterface.sequelize.query(text, { transaction });

      await queryInterface.createTable(
        'config_fiscal',
        {
          cooperativa_id: { ...coop, primaryKey: true },
          ambiente: { type: STRING(14), allowNull: false, defaultValue: 'simulado' },
          // `null` = el CUIT de la cooperativa.
          cuit: { type: STRING(11), allowNull: true },
          certificado: { type: TEXT, allowNull: true },
          clave_cifrada: { type: TEXT, allowNull: true },
          certificado_titular: { type: STRING(200), allowNull: true },
          certificado_vence: { type: DATEONLY, allowNull: true },
          tratamientos_json: { type: JSONB, allowNull: false, defaultValue: {} },
          ta_cifrado: { type: TEXT, allowNull: true },
          ta_vence: { type: DATE, allowNull: true },
          ta_ambiente: { type: STRING(14), allowNull: true },
          ultima_prueba_el: { type: DATE, allowNull: true },
          ultima_prueba_ok: { type: BOOLEAN, allowNull: true },
          ultima_prueba_detalle: { type: STRING(500), allowNull: true },
          actualizado_por: usuario(true),
          creado_el: { type: DATE, allowNull: false, defaultValue: now },
          actualizado_el: { type: DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );
      await sql(`ALTER TABLE config_fiscal ADD CONSTRAINT config_fiscal_ambiente CHECK (ambiente IN ('simulado', 'homologacion', 'produccion'))`);

      await sql(`ALTER TABLE comprobantes ADD COLUMN cae_ambiente varchar(14) NULL`);
      await sql(`UPDATE comprobantes SET cae_ambiente = 'simulado' WHERE cae IS NOT NULL`);
      await sql(`ALTER TABLE comprobantes ADD CONSTRAINT comprobantes_cae_ambiente CHECK (cae_ambiente IN ('simulado', 'homologacion', 'produccion'))`);

      for (const tabla of ['comprobantes', 'pagos', 'auditoria']) {
        await sql(`ALTER TABLE ${tabla} ADD COLUMN huella char(64) NULL`);
      }
      // El registro de cambios se encadena en el orden en que se sella (cada operación sella el suyo al
      // confirmarse): n.º de eslabón propio, sin huecos, por cooperativa (0 = SRV).
      await sql(`ALTER TABLE auditoria ADD COLUMN sellado_n bigint NULL`);
      await sql(`CREATE UNIQUE INDEX auditoria_cadena ON auditoria ((COALESCE(cooperativa_id, 0)), sellado_n) WHERE sellado_n IS NOT NULL`);

      await queryInterface.createTable(
        'verificaciones_integridad',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: coop,
          origen: { type: STRING(10), allowNull: false },
          estado: { type: STRING(14), allowNull: false, defaultValue: 'en_curso' },
          usuario_id: usuario(true),
          resumen_json: { type: JSONB, allowNull: true },
          problemas_json: { type: JSONB, allowNull: true },
          error: { type: STRING(300), allowNull: true },
          iniciada_el: { type: DATE, allowNull: false, defaultValue: now },
          terminada_el: { type: DATE, allowNull: true },
        },
        { transaction },
      );
      await sql(`ALTER TABLE verificaciones_integridad ADD CONSTRAINT verificaciones_origen CHECK (origen IN ('manual', 'automatica'))`);
      await sql(`ALTER TABLE verificaciones_integridad ADD CONSTRAINT verificaciones_estado CHECK (estado IN ('en_curso', 'ok', 'con_problemas', 'fallida'))`);
      await sql(`CREATE INDEX verificaciones_recientes ON verificaciones_integridad (cooperativa_id, iniciada_el DESC)`);
      // Una sola verificación corriendo por cooperativa.
      await sql(`CREATE UNIQUE INDEX verificaciones_una_en_curso ON verificaciones_integridad (cooperativa_id) WHERE estado = 'en_curso'`);

      await queryInterface.createTable(
        'alertas',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          // La cooperativa de la que habla la alerta. El destinatario puede ser de SRV (sin cooperativa).
          cooperativa_id: coop,
          usuario_id: usuario(false),
          tipo: { type: STRING(30), allowNull: false },
          titulo: { type: STRING(160), allowNull: false },
          cuerpo: { type: TEXT, allowNull: false },
          enlace: { type: STRING(200), allowNull: true },
          leida_el: { type: DATE, allowNull: true },
          correo_destino: { type: STRING(200), allowNull: true },
          correo_estado: { type: STRING(12), allowNull: false },
          correo_error: { type: STRING(300), allowNull: true },
          creado_el: { type: DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );
      await sql(`ALTER TABLE alertas ADD CONSTRAINT alertas_correo_estado CHECK (correo_estado IN ('enviado', 'simulado', 'fallido', 'sin_correo'))`);
      await sql(`CREATE INDEX alertas_bandeja ON alertas (usuario_id, creado_el DESC)`);

      await queryInterface.createTable(
        'intentos_acceso_socio',
        {
          cooperativa_id: { ...coop, primaryKey: true },
          // El código de socio tal como lo escribieron (exista o no): así el bloqueo no revela si existe.
          clave: { type: STRING(40), allowNull: false, primaryKey: true },
          fallidos: { type: INTEGER, allowNull: false, defaultValue: 0 },
          primer_fallo_el: { type: DATE, allowNull: false, defaultValue: now },
          bloqueado_hasta: { type: DATE, allowNull: true },
        },
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (text) => queryInterface.sequelize.query(text, { transaction });
      await queryInterface.dropTable('intentos_acceso_socio', { transaction });
      await queryInterface.dropTable('alertas', { transaction });
      await queryInterface.dropTable('verificaciones_integridad', { transaction });
      await sql(`DROP INDEX IF EXISTS auditoria_cadena`);
      await sql(`ALTER TABLE auditoria DROP COLUMN sellado_n`);
      for (const tabla of ['comprobantes', 'pagos', 'auditoria']) await sql(`ALTER TABLE ${tabla} DROP COLUMN huella`);
      await sql(`ALTER TABLE comprobantes DROP CONSTRAINT comprobantes_cae_ambiente`);
      await sql(`ALTER TABLE comprobantes DROP COLUMN cae_ambiente`);
      await queryInterface.dropTable('config_fiscal', { transaction });
    });
  },
};
