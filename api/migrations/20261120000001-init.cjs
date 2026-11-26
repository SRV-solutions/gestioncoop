'use strict';

/** Fase 0: cooperativas (tenants), usuarios, roles, sesiones y auditoría. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, BOOLEAN, DATE, JSONB, UUID } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');

    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'cooperativas',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          nombre: { type: STRING(200), allowNull: false },
          nombre_corto: { type: STRING(80), allowNull: false },
          cuit: { type: STRING(11), allowNull: false },
          subdominio: { type: STRING(60), allowNull: false, unique: true },
          tema_json: { type: JSONB, allowNull: false },
          config_json: { type: JSONB, allowNull: false },
          activa: { type: BOOLEAN, allowNull: false, defaultValue: true },
          creado_el: { type: DATE, allowNull: false, defaultValue: now },
          actualizado_el: { type: DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );

      await queryInterface.createTable(
        'usuarios',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: {
            type: INTEGER,
            allowNull: true, // null solo para el superadmin (usuario del proveedor)
            references: { model: 'cooperativas', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
          },
          email: { type: STRING(200), allowNull: false },
          hash: { type: STRING(255), allowNull: false },
          nombre: { type: STRING(160), allowNull: false },
          activo: { type: BOOLEAN, allowNull: false, defaultValue: true },
          es_demo: { type: BOOLEAN, allowNull: false, defaultValue: false },
          ultimo_ingreso_el: { type: DATE, allowNull: true },
          creado_el: { type: DATE, allowNull: false, defaultValue: now },
          actualizado_el: { type: DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );
      await queryInterface.sequelize.query('CREATE UNIQUE INDEX usuarios_email_unico ON usuarios (lower(email))', { transaction });
      await queryInterface.addIndex('usuarios', ['cooperativa_id'], { name: 'usuarios_cooperativa_idx', transaction });

      await queryInterface.createTable(
        'roles_usuario',
        {
          usuario_id: {
            type: INTEGER,
            primaryKey: true,
            references: { model: 'usuarios', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          rol: { type: STRING(20), primaryKey: true },
        },
        { transaction },
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE roles_usuario ADD CONSTRAINT roles_usuario_rol_valido
         CHECK (rol IN ('socio','operario','cajero','facturacion','gerencia','admin','superadmin'))`,
        { transaction },
      );

      await queryInterface.createTable(
        'sesiones',
        {
          id: { type: UUID, primaryKey: true },
          usuario_id: {
            type: INTEGER,
            allowNull: false,
            references: { model: 'usuarios', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          token_hash: { type: STRING(64), allowNull: false },
          cooperativa_activa_id: {
            type: INTEGER,
            allowNull: true,
            references: { model: 'cooperativas', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          expira_el: { type: DATE, allowNull: false },
          revocada_el: { type: DATE, allowNull: true },
          usado_el: { type: DATE, allowNull: true },
          user_agent: { type: STRING(300), allowNull: true },
          ip: { type: STRING(64), allowNull: true },
          creado_el: { type: DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );
      await queryInterface.addIndex('sesiones', ['usuario_id'], { name: 'sesiones_usuario_idx', transaction });

      await queryInterface.createTable(
        'auditoria',
        {
          id: { type: INTEGER, autoIncrement: true, primaryKey: true },
          cooperativa_id: {
            type: INTEGER,
            allowNull: true, // null para acciones del proveedor que no son de una cooperativa
            references: { model: 'cooperativas', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
          },
          usuario_id: {
            type: INTEGER,
            allowNull: true,
            references: { model: 'usuarios', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          accion: { type: STRING(80), allowNull: false },
          entidad: { type: STRING(80), allowNull: false },
          entidad_id: { type: STRING(80), allowNull: true },
          antes_json: { type: JSONB, allowNull: true },
          despues_json: { type: JSONB, allowNull: true },
          ip: { type: STRING(64), allowNull: true },
          creado_el: { type: DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );
      await queryInterface.addIndex('auditoria', ['cooperativa_id', 'creado_el'], { name: 'auditoria_cooperativa_fecha_idx', transaction });
      await queryInterface.addIndex('auditoria', ['entidad', 'entidad_id'], { name: 'auditoria_entidad_idx', transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const table of ['auditoria', 'sesiones', 'roles_usuario', 'usuarios', 'cooperativas']) {
        await queryInterface.dropTable(table, { transaction });
      }
    });
  },
};
